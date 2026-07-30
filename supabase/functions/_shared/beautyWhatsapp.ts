import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

export function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: jsonHeaders });
}

export function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  if (message.includes('fetch')) return { code: 'PROVIDER_UNAVAILABLE', message: 'No se puede contactar con WhatsApp ahora mismo.' };
  if (message.includes('401') || message.includes('403')) return { code: 'PROVIDER_AUTH_ERROR', message: 'La conexión de WhatsApp necesita revisión técnica.' };
  return { code: 'WHATSAPP_OPERATION_FAILED', message: 'No hemos podido completar la operación de WhatsApp.' };
}

export function serverClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SERVER_CONFIGURATION_MISSING');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireUser(request: Request, client: SupabaseClient) {
  const authorization = request.headers.get('authorization') ?? '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('UNAUTHENTICATED');
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHENTICATED');
  return data.user;
}

export async function requireMembership(
  client: SupabaseClient,
  userId: string,
  businessId: string,
  roles: string[],
) {
  const { data, error } = await client
    .from('business_members')
    .select('id,role')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('active', true)
    .maybeSingle();
  if (error || !data || !roles.includes(String(data.role))) throw new Error('INSUFFICIENT_BUSINESS_PERMISSION');
  return data;
}

export function evolutionConfig() {
  const baseUrl = Deno.env.get('EVOLUTION_API_URL')?.replace(/\/+$/, '');
  const apiKey = Deno.env.get('EVOLUTION_API_KEY');
  if (!baseUrl || !apiKey) throw new Error('EVOLUTION_CONFIGURATION_MISSING');
  return { baseUrl, apiKey };
}

export async function evolutionFetch(path: string, init: RequestInit = {}) {
  const { baseUrl, apiKey } = evolutionConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: apiKey,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!response.ok) throw new Error(`EVOLUTION_${response.status}`);
  return body;
}

export function connectionView(row: Record<string, unknown> | null) {
  if (!row) return {
    status: 'not_provisioned',
    phoneNumber: null,
    displayName: null,
    connectedAt: null,
    error: null,
  };
  return {
    id: row.id,
    status: row.connection_status,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    connectedAt: row.connected_at,
    error: row.last_error_message ? { code: row.last_error_code, message: row.last_error_message } : null,
  };
}

export function parseBody(request: Request, maxBytes = 16_384) {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > maxBytes) throw new Error('PAYLOAD_TOO_LARGE');
  return request.json();
}

export function makeInstanceName(businessId: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `beauty_${businessId.replaceAll('-', '').slice(0, 8)}_${suffix}`;
}

export function normalizeConnectionState(value: unknown) {
  const state = String(value ?? '').toLowerCase();
  if (state === 'open' || state === 'connected') return 'connected';
  if (state === 'connecting') return 'connecting';
  if (state === 'close' || state === 'closed' || state === 'disconnected') return 'disconnected';
  return 'error';
}
