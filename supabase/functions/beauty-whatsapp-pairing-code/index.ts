import {
  evolutionFetch, json, normalizeConnectionState, optionsResponse, parseBody, requireMembership, requireUser, safeError, serverClient,
} from '../_shared/beautyWhatsapp.ts';
import { canRequestPairingCode, normalizeInternationalPhone, pairingCodeFromProvider } from '../_shared/beautyWhatsappPairing.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const client = serverClient();
  try {
    const user = await requireUser(request, client);
    const body = await parseBody(request) as { businessId?: unknown; phoneNumber?: unknown; authorizationConfirmed?: unknown };
    const businessId = String(body.businessId ?? '');
    if (!body.authorizationConfirmed) return json(400, { error: 'AUTHORIZATION_CONFIRMATION_REQUIRED' });
    await requireMembership(client, user.id, businessId, ['owner', 'admin']);
    const phoneNumber = normalizeInternationalPhone(body.phoneNumber);
    if (!phoneNumber) return json(400, { error: 'INVALID_PHONE_NUMBER', message: 'Introduce el número con prefijo internacional.' });

    const connection = await client.from('beauty_whatsapp_connections').select('id,instance_name,connection_status')
      .eq('business_id', businessId).maybeSingle();
    if (!connection.data) return json(404, { error: 'CONNECTION_NOT_PROVISIONED' });
    if (!canRequestPairingCode(true, String(connection.data.connection_status))) {
      return json(409, { error: 'ALREADY_CONNECTED', message: 'WhatsApp ya está conectado.' });
    }

    const state = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(connection.data.instance_name)}`) as Record<string, unknown>;
    const providerState = normalizeConnectionState((state.instance as Record<string, unknown> | undefined)?.state ?? state.state);
    if (!canRequestPairingCode(true, providerState)) {
      return json(409, { error: 'ALREADY_CONNECTED', message: 'WhatsApp ya está conectado.' });
    }

    const provider = await evolutionFetch(`/instance/connect/${encodeURIComponent(connection.data.instance_name)}?number=${encodeURIComponent(phoneNumber)}`);
    const pairingCode = pairingCodeFromProvider(provider, true);
    if (!pairingCode) return json(409, {
      error: 'PAIRING_CODE_NOT_AVAILABLE',
      message: 'Evolution no devolvió un campo pairingCode reconocido.',
    });
    return json(200, { pairingCode });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'UNAUTHENTICATED') return json(401, { error: 'SESSION_EXPIRED' });
    if (message === 'INSUFFICIENT_BUSINESS_PERMISSION') return json(403, { error: 'INSUFFICIENT_PERMISSION' });
    const safe = safeError(error);
    return json(502, { error: safe.code, message: safe.message });
  }
});
