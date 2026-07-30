import { json, normalizeConnectionState, serverClient } from '../_shared/beautyWhatsapp.ts';
import { buildConversationMutation } from './conversationMutation.ts';

const buckets = new Map<string, { count: number; resetAt: number }>();

function allowRequest(request: Request) {
  const key = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  current.count += 1;
  return current.count <= 120;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function eventName(payload: Record<string, unknown>) {
  return String(payload.event ?? payload.type ?? '').toUpperCase().replaceAll('.', '_');
}

function instanceName(payload: Record<string, unknown>) {
  return String(payload.instance ?? asRecord(payload.data).instance ?? '');
}

function providerMessageId(data: Record<string, unknown>) {
  return String(asRecord(data.key).id ?? data.id ?? '');
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, '0')).join('');
}

function messageType(message: Record<string, unknown>) {
  if (message.conversation || asRecord(message.extendedTextMessage).text) return 'text';
  if (message.imageMessage) return 'image';
  if (message.audioMessage) return 'audio';
  if (message.documentMessage) return 'document';
  if (message.videoMessage) return 'video';
  if (message.locationMessage) return 'location';
  if (message.contactMessage || message.contactsArrayMessage) return 'contact';
  return 'unknown';
}

function messageText(message: Record<string, unknown>, type: string) {
  if (type === 'text') return String(message.conversation ?? asRecord(message.extendedTextMessage).text ?? '').slice(0, 4096);
  const labels: Record<string, string> = {
    image: 'Imagen recibida', audio: 'Audio recibido', document: 'Documento recibido',
    video: 'Vídeo recibido', location: 'Ubicación recibida', contact: 'Contacto recibido',
    unknown: 'Mensaje no compatible',
  };
  return labels[type] ?? labels.unknown;
}

function normalizePhone(remoteJid: string) {
  return remoteJid.split('@')[0].replace(/\D/g, '').slice(0, 20);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  if (!allowRequest(request)) return json(429, { error: 'RATE_LIMITED' });
  const expected = Deno.env.get('EVOLUTION_WEBHOOK_SECRET') ?? '';
  const supplied = request.headers.get('x-evolution-webhook-secret')
    ?? new URL(request.url).searchParams.get('secret')
    ?? '';
  if (!expected || supplied.length !== expected.length) return json(401, { error: 'INVALID_WEBHOOK_SECRET' });
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(supplied);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  if (difference !== 0) return json(401, { error: 'INVALID_WEBHOOK_SECRET' });

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > 262_144) return json(413, { error: 'PAYLOAD_TOO_LARGE' });
  let payload: Record<string, unknown>;
  try { payload = asRecord(await request.json()); } catch { return json(400, { error: 'INVALID_JSON' }); }

  const client = serverClient();
  const instance = instanceName(payload);
  const event = eventName(payload);
  if (!instance || !event) return json(400, { error: 'INVALID_EVENT' });
  const connection = await client.from('beauty_whatsapp_connections').select('*').eq('instance_name', instance).maybeSingle();
  if (!connection.data) return json(404, { error: 'UNKNOWN_INSTANCE' });

  const dataValue = payload.data;
  const items = Array.isArray(dataValue) ? dataValue : [dataValue];
  const firstData = asRecord(items[0]);
  const firstMessageId = providerMessageId(firstData);
  const providerEventId = String(payload.id ?? await digest(`${instance}|${event}|${firstMessageId}|${JSON.stringify(dataValue)}`));
  const audit = await client.from('beauty_whatsapp_webhook_events').insert({
    provider_event_id: providerEventId,
    business_id: connection.data.business_id,
    instance_name: instance,
    event_type: event,
    provider_message_id: firstMessageId || null,
    payload_summary: { event, messageCount: items.length },
  }).select('id').single();
  if (audit.error?.code === '23505') return json(200, { received: true, duplicate: true });
  if (audit.error) return json(500, { error: 'EVENT_AUDIT_FAILED' });

  try {
    if (event === 'CONNECTION_UPDATE' || event === 'QRCODE_UPDATED') {
      const state = normalizeConnectionState(firstData.state ?? firstData.status);
      const isQr = event === 'QRCODE_UPDATED';
      const update: Record<string, unknown> = {
        last_event_at: new Date().toISOString(),
        connection_status: isQr ? 'awaiting_qr' : state,
        qr_status: isQr ? 'available' : state === 'connected' ? 'scanned' : connection.data.qr_status,
      };
      if (state === 'connected') {
        update.connected_at = connection.data.connected_at ?? new Date().toISOString();
        update.activated_at = connection.data.activated_at ?? new Date().toISOString();
        update.phone_number = String(firstData.wuid ?? firstData.number ?? '').split('@')[0] || connection.data.phone_number;
      }
      if (state === 'disconnected') update.disconnected_at = new Date().toISOString();
      await client.from('beauty_whatsapp_connections').update(update).eq('id', connection.data.id);
    } else if (event === 'MESSAGES_UPSERT' || event === 'SEND_MESSAGE') {
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex];
        const data = asRecord(item);
        const key = asRecord(data.key);
        const remoteJid = String(key.remoteJid ?? '');
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast') || remoteJid.includes('@newsletter')) continue;
        const sentAt = new Date(Number(data.messageTimestamp ?? Date.now() / 1000) * 1000);
        if (connection.data.activated_at && sentAt < new Date(connection.data.activated_at)) continue;
        const fromMe = Boolean(key.fromMe);
        const message = asRecord(data.message);
        const type = messageType(message);
        const text = messageText(message, type);
        const phone = normalizePhone(remoteJid);
        const customer = phone
          ? await client.from('customers').select('id').eq('business_id', connection.data.business_id).eq('phone_normalized', phone).eq('active', true).maybeSingle()
          : { data: null };
        const existingConversation = await client.from('beauty_conversations').select('*')
          .eq('whatsapp_connection_id', connection.data.id).eq('remote_jid', remoteJid).maybeSingle();
        const conversationValues: Record<string, unknown> = {
          business_id: connection.data.business_id,
          whatsapp_connection_id: connection.data.id,
          customer_id: customer.data?.id ?? null,
          remote_jid: remoteJid,
          remote_phone_normalized: phone || null,
          contact_name: String(data.pushName ?? '') || null,
          last_message_at: sentAt.toISOString(),
          last_message_preview: text.slice(0, 240),
          active: true,
        };
        const mutation = buildConversationMutation(
          existingConversation.data
            ? { id: existingConversation.data.id, mode: existingConversation.data.mode }
            : null,
          fromMe,
          conversationValues,
        );
        const conversationResult = mutation.kind === 'insert'
          ? await client.from('beauty_conversations').insert(mutation.values).select('*').single()
          : await client.from('beauty_conversations').update(mutation.values).eq('id', mutation.id).select('*').single();
        if (!conversationResult.data) continue;
        const inserted = await client.from('beauty_messages').insert({
          business_id: connection.data.business_id,
          conversation_id: conversationResult.data.id,
          provider_message_id: providerMessageId(data) || `${providerEventId}:${itemIndex}`,
          direction: fromMe ? 'outbound' : 'inbound',
          sender_type: fromMe ? 'human' : 'customer',
          message_type: type,
          text_content: text,
          status: fromMe ? 'sent' : 'received',
          sent_at: sentAt.toISOString(),
          raw_event_reference: audit.data.id,
        });
        if (!fromMe && !inserted.error) {
          await client.rpc('increment_beauty_conversation_unread', { p_conversation_id: conversationResult.data.id });
        }
      }
    } else if (event === 'MESSAGES_UPDATE') {
      for (const item of items) {
        const data = asRecord(item);
        const id = providerMessageId(data);
        const rawStatus = String(data.status ?? asRecord(data.update).status ?? '').toLowerCase();
        const status = rawStatus.includes('read') ? 'read' : rawStatus.includes('deliver') ? 'delivered' : rawStatus.includes('fail') ? 'failed' : 'sent';
        const update: Record<string, unknown> = { status };
        if (status === 'delivered') update.delivered_at = new Date().toISOString();
        if (status === 'read') update.read_at = new Date().toISOString();
        await client.from('beauty_messages').update(update).eq('business_id', connection.data.business_id).eq('provider_message_id', id);
      }
    }
    await client.from('beauty_whatsapp_webhook_events').update({
      processed_at: new Date().toISOString(), processing_status: 'processed',
    }).eq('id', audit.data.id);
    return json(200, { received: true });
  } catch {
    await client.from('beauty_whatsapp_webhook_events').update({
      processed_at: new Date().toISOString(),
      processing_status: 'failed',
      error_message: 'EVENT_PROCESSING_FAILED',
    }).eq('id', audit.data.id);
    return json(200, { received: true, processed: false });
  }
});
