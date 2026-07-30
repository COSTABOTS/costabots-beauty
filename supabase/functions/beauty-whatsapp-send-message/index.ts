import {
  evolutionFetch, json, optionsResponse, parseBody, requireMembership, requireUser, safeError, serverClient,
} from '../_shared/beautyWhatsapp.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const client = serverClient();
  try {
    const user = await requireUser(request, client);
    const body = await parseBody(request) as { businessId: string; conversationId: string; text: string; clientRequestId: string };
    const text = String(body.text ?? '').trim();
    if (!text || text.length > 2000 || !/^[a-zA-Z0-9_-]{10,100}$/.test(String(body.clientRequestId ?? ''))) {
      return json(400, { error: 'INVALID_MESSAGE' });
    }
    await requireMembership(client, user.id, body.businessId, ['owner','admin','staff']);
    const conversation = await client.from('beauty_conversations')
      .select('*,beauty_whatsapp_connections!inner(instance_name,connection_status)')
      .eq('id', body.conversationId).eq('business_id', body.businessId).single();
    if (conversation.error || !conversation.data) return json(404, { error: 'CONVERSATION_NOT_FOUND' });
    if (conversation.data.mode !== 'manual') return json(409, { error: 'TAKE_CONVERSATION_FIRST' });
    const connection = conversation.data.beauty_whatsapp_connections as unknown as { instance_name: string; connection_status: string };
    if (connection.connection_status !== 'connected') return json(409, { error: 'WHATSAPP_DISCONNECTED' });
    const existing = await client.from('beauty_messages').select('id,status').eq('conversation_id', body.conversationId).eq('client_request_id', body.clientRequestId).maybeSingle();
    if (existing.data) return json(200, existing.data);

    // Reserve the idempotency key before contacting Evolution. Concurrent
    // retries cannot both pass this unique insert and therefore cannot double-send.
    const reserved = await client.from('beauty_messages').insert({
      business_id: body.businessId,
      conversation_id: body.conversationId,
      provider_message_id: `manager:${body.clientRequestId}`,
      client_request_id: body.clientRequestId,
      direction: 'outbound',
      sender_type: 'human',
      message_type: 'text',
      text_content: text,
      status: 'pending',
      sent_at: new Date().toISOString(),
    }).select('id,status').single();
    if (reserved.error?.code === '23505') {
      const concurrent = await client.from('beauty_messages').select('id,status')
        .eq('conversation_id', body.conversationId).eq('client_request_id', body.clientRequestId).single();
      return json(200, concurrent.data);
    }
    if (reserved.error || !reserved.data) throw reserved.error;

    let actualId = `manager:${body.clientRequestId}`;
    try {
      const response = await evolutionFetch(`/message/sendText/${encodeURIComponent(connection.instance_name)}`, {
        method: 'POST',
        body: JSON.stringify({ number: conversation.data.remote_phone_normalized, text }),
      }) as Record<string, unknown>;
      actualId = String((response.key as Record<string, unknown> | undefined)?.id ?? actualId);
    } catch (error) {
      await client.from('beauty_messages').update({ status: 'failed' }).eq('id', reserved.data.id);
      throw error;
    }
    const inserted = await client.from('beauty_messages').update({
      provider_message_id: actualId,
      status: 'sent',
    }).eq('id', reserved.data.id).select('id,status').single();
    await client.from('beauty_conversations').update({
      last_message_at: new Date().toISOString(),
      last_message_preview: text.slice(0, 240),
    }).eq('id', body.conversationId);
    if (inserted.error) throw inserted.error;
    return json(200, inserted.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'UNAUTHENTICATED') return json(401, { error: 'SESSION_EXPIRED' });
    if (message === 'INSUFFICIENT_BUSINESS_PERMISSION') return json(403, { error: 'INSUFFICIENT_PERMISSION' });
    const safe = safeError(error);
    return json(502, { error: safe.code, message: safe.message });
  }
});
