import {
  evolutionFetch, json, parseBody, requireMembership, requireUser, safeError, serverClient,
} from '../_shared/beautyWhatsapp.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const client = serverClient();
  try {
    const user = await requireUser(request, client);
    const { businessId, authorizationConfirmed } = await parseBody(request) as { businessId: string; authorizationConfirmed: boolean };
    if (!authorizationConfirmed) return json(400, { error: 'AUTHORIZATION_CONFIRMATION_REQUIRED' });
    await requireMembership(client, user.id, businessId, ['owner','admin']);
    const connection = await client.from('beauty_whatsapp_connections').select('*').eq('business_id', businessId).single();
    if (connection.error || !connection.data) return json(404, { error: 'CONNECTION_NOT_PROVISIONED' });
    const provider = await evolutionFetch(`/instance/connect/${encodeURIComponent(connection.data.instance_name)}`) as Record<string, unknown>;
    const qr = String(provider.base64 ?? provider.code ?? '');
    if (!qr) return json(409, { error: 'QR_NOT_AVAILABLE', message: 'El código QR todavía no está disponible.' });
    await client.from('beauty_whatsapp_connections').update({
      connection_status: 'awaiting_qr', qr_status: 'available',
    }).eq('id', connection.data.id);
    return json(200, { qr, expiresInSeconds: 45 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'UNAUTHENTICATED') return json(401, { error: 'SESSION_EXPIRED' });
    if (message === 'INSUFFICIENT_BUSINESS_PERMISSION') return json(403, { error: 'INSUFFICIENT_PERMISSION' });
    const safe = safeError(error);
    return json(502, { error: safe.code, message: safe.message });
  }
});
