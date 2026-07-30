import {
  connectionView, evolutionFetch, json, parseBody, requireMembership, requireUser, safeError, serverClient,
} from '../_shared/beautyWhatsapp.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const client = serverClient();
  try {
    const user = await requireUser(request, client);
    const { businessId, confirmed } = await parseBody(request) as { businessId: string; confirmed: boolean };
    if (!confirmed) return json(400, { error: 'CONFIRMATION_REQUIRED' });
    await requireMembership(client, user.id, businessId, ['owner','admin']);
    const connection = await client.from('beauty_whatsapp_connections').select('*').eq('business_id', businessId).single();
    if (connection.error || !connection.data) return json(404, { error: 'CONNECTION_NOT_PROVISIONED' });
    await evolutionFetch(`/instance/logout/${encodeURIComponent(connection.data.instance_name)}`, { method: 'DELETE' });
    const updated = await client.from('beauty_whatsapp_connections').update({
      connection_status: 'disconnected',
      disconnected_at: new Date().toISOString(),
      qr_status: 'unavailable',
    }).eq('id', connection.data.id).select('*').single();
    return json(200, connectionView(updated.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'UNAUTHENTICATED') return json(401, { error: 'SESSION_EXPIRED' });
    if (message === 'INSUFFICIENT_BUSINESS_PERMISSION') return json(403, { error: 'INSUFFICIENT_PERMISSION' });
    const safe = safeError(error);
    return json(502, { error: safe.code, message: safe.message });
  }
});
