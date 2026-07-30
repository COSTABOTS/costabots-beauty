import {
  connectionView, evolutionFetch, json, normalizeConnectionState, optionsResponse, parseBody,
  requireMembership, requireUser, safeError, serverClient,
} from '../_shared/beautyWhatsapp.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const client = serverClient();
  try {
    const user = await requireUser(request, client);
    const { businessId } = await parseBody(request) as { businessId: string };
    await requireMembership(client, user.id, businessId, ['owner','admin','staff']);
    const connection = await client.from('beauty_whatsapp_connections').select('*').eq('business_id', businessId).maybeSingle();
    if (!connection.data) return json(200, connectionView(null));
    const provider = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(connection.data.instance_name)}`) as Record<string, unknown>;
    const stateValue = (provider.instance as Record<string, unknown> | undefined)?.state ?? provider.state;
    const status = normalizeConnectionState(stateValue);
    const updated = await client.from('beauty_whatsapp_connections').update({
      connection_status: status,
      connected_at: status === 'connected' ? connection.data.connected_at ?? new Date().toISOString() : connection.data.connected_at,
      disconnected_at: status === 'disconnected' ? new Date().toISOString() : connection.data.disconnected_at,
      last_error_code: null,
      last_error_message: null,
    }).eq('id', connection.data.id).select('*').single();
    return json(200, connectionView(updated.data ?? connection.data));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'UNAUTHENTICATED') return json(401, { error: 'SESSION_EXPIRED' });
    if (message === 'INSUFFICIENT_BUSINESS_PERMISSION') return json(403, { error: 'INSUFFICIENT_PERMISSION' });
    const safe = safeError(error);
    return json(502, { error: safe.code, message: safe.message });
  }
});
