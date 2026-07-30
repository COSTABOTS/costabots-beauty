import {
  connectionView, evolutionFetch, json, makeInstanceName, parseBody,
  requireMembership, requireUser, safeError, serverClient,
} from '../_shared/beautyWhatsapp.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const client = serverClient();
  let businessId = '';
  try {
    const user = await requireUser(request, client);
    const body = await parseBody(request) as { businessId?: string };
    businessId = String(body.businessId ?? '');
    await requireMembership(client, user.id, businessId, ['owner', 'admin']);

    const existing = await client.from('beauty_whatsapp_connections').select('*').eq('business_id', businessId).maybeSingle();
    if (existing.data) return json(200, connectionView(existing.data));

    const instanceName = makeInstanceName(businessId);
    const inserted = await client.from('beauty_whatsapp_connections').insert({
      business_id: businessId,
      instance_name: instanceName,
      connection_status: 'provisioning',
    }).select('*').single();
    if (inserted.error) {
      const concurrent = await client.from('beauty_whatsapp_connections').select('*').eq('business_id', businessId).single();
      if (concurrent.data) return json(200, connectionView(concurrent.data));
      throw inserted.error;
    }

    const created = await evolutionFetch('/instance/create', {
      method: 'POST',
      body: JSON.stringify({ instanceName, integration: 'WHATSAPP-BAILEYS', qrcode: false }),
    }) as Record<string, unknown>;
    const webhookSecret = Deno.env.get('EVOLUTION_WEBHOOK_SECRET');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!webhookSecret || !supabaseUrl) throw new Error('WEBHOOK_CONFIGURATION_MISSING');
    const webhookUrl = `${supabaseUrl}/functions/v1/evolution-beauty-webhook?secret=${encodeURIComponent(webhookSecret)}`;
    await evolutionFetch(`/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['QRCODE_UPDATED','CONNECTION_UPDATE','MESSAGES_UPSERT','MESSAGES_UPDATE','SEND_MESSAGE'],
        },
      }),
    });
    const updated = await client.from('beauty_whatsapp_connections').update({
      instance_external_id: String((created.instance as Record<string, unknown> | undefined)?.instanceId ?? '') || null,
      connection_status: 'awaiting_qr',
      qr_status: 'unavailable',
      last_error_code: null,
      last_error_message: null,
    }).eq('id', inserted.data.id).select('*').single();
    if (updated.error) throw updated.error;
    return json(200, connectionView(updated.data));
  } catch (error) {
    const safe = safeError(error);
    if (businessId) await client.from('beauty_whatsapp_connections').update({
      connection_status: 'error', last_error_code: safe.code, last_error_message: safe.message,
    }).eq('business_id', businessId).eq('connection_status', 'provisioning');
    const message = error instanceof Error ? error.message : '';
    if (message === 'UNAUTHENTICATED') return json(401, { error: 'SESSION_EXPIRED' });
    if (message === 'INSUFFICIENT_BUSINESS_PERMISSION') return json(403, { error: 'INSUFFICIENT_PERMISSION' });
    return json(502, { error: safe.code, message: safe.message });
  }
});
