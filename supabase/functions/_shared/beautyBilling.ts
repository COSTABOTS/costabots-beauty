import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { allowedMonthlyPriceId, eventIsTest, strictTestObject } from './beautyBillingRules.ts';

export const cors = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: cors });
export const options = () => new Response(null, { status: 204, headers: cors });

export function serverClient() {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SERVER_CONFIGURATION_MISSING');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function requireUser(request: Request, client: SupabaseClient) {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const { data, error } = token ? await client.auth.getUser(token) : { data: { user: null }, error: new Error('missing') };
  if (error || !data.user) throw new Error('UNAUTHENTICATED');
  return data.user;
}

export async function requireTestOwner(client: SupabaseClient, businessId: string, userId: string) {
  const { data, error } = await client.from('beauty_billing_test_subjects').select('business_id,enabled').eq('business_id', businessId).eq('enabled', true).maybeSingle();
  if (error || !data) throw new Error('BILLING_TEST_NOT_ENABLED');
  const member = await client.from('business_members').select('id').eq('business_id', businessId).eq('user_id', userId).eq('role', 'owner').eq('active', true).maybeSingle();
  if (member.error || !member.data) throw new Error('INSUFFICIENT_BUSINESS_PERMISSION');
}

function stripeConfig() {
  const secretKey = Deno.env.get('STRIPE_TEST_SECRET_KEY');
  const founderPrice = Deno.env.get('STRIPE_TEST_PRICE_FOUNDER_MONTHLY_EUR');
  const standardPrice = Deno.env.get('STRIPE_TEST_PRICE_STANDARD_MONTHLY_EUR');
  if (!secretKey?.startsWith('sk_test_') || !founderPrice?.startsWith('price_') || !standardPrice?.startsWith('price_')) throw new Error('STRIPE_TEST_CONFIGURATION_MISSING');
  return { secretKey, founderPrice, standardPrice };
}

export function prices() { return stripeConfig(); }
export async function stripeGet(path: string) { return stripeRequest(path, { method: 'GET' }); }
export async function stripeRequest(path: string, init: RequestInit) {
  const { secretKey } = stripeConfig();
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, '')}`, { ...init, headers: { authorization: `Basic ${btoa(`${secretKey}:`)}`, ...(init.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`STRIPE_${response.status}`);
  return body as Record<string, unknown>;
}

export function requireTestStripeObject(object: Record<string, unknown>, kind: string) {
  if (!strictTestObject(object)) throw new Error(`LIVE_OR_UNKNOWN_${kind.toUpperCase()}_REJECTED`);
  return object;
}

export function checkoutSessionDetails(session: Record<string, unknown>) {
  requireTestStripeObject(session, 'checkout_session');
  const id = String(session.id ?? '');
  const url = String(session.url ?? '');
  const expiresAt = Number(session.expires_at ?? 0);
  if (!id || !url.startsWith('https://') || !Number.isFinite(expiresAt) || expiresAt * 1000 <= Date.now()) {
    throw new Error('INVALID_TEST_CHECKOUT_SESSION');
  }
  return { id, url, customerId: String(session.customer ?? ''), expiresAt };
}

export function customerDetails(customer: Record<string, unknown>) {
  requireTestStripeObject(customer, 'customer');
  const id = String(customer.id ?? '');
  if (!id) throw new Error('INVALID_TEST_CUSTOMER');
  return { id };
}

function bytes(value: string) { return new TextEncoder().encode(value); }
function hex(input: ArrayBuffer) { return [...new Uint8Array(input)].map((v) => v.toString(16).padStart(2, '0')).join(''); }
function timingSafeEqual(a: string, b: string) { if (a.length !== b.length) return false; let result = 0; for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i); return result === 0; }

export async function verifyStripeTestSignature(raw: string, signature: string | null) {
  const secret = Deno.env.get('STRIPE_TEST_WEBHOOK_SECRET');
  if (!secret?.startsWith('whsec_') || !signature) throw new Error('INVALID_STRIPE_SIGNATURE');
  const pairs = signature.split(',').map((item) => item.split('='));
  const timestamp = pairs.find(([key]) => key === 't')?.[1];
  const signatures = pairs.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error('INVALID_STRIPE_SIGNATURE');
  const key = await crypto.subtle.importKey('raw', bytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = hex(await crypto.subtle.sign('HMAC', key, bytes(`${timestamp}.${raw}`)));
  if (!signatures.some((candidate) => timingSafeEqual(candidate, digest))) throw new Error('INVALID_STRIPE_SIGNATURE');
  const event = JSON.parse(raw) as Record<string, unknown>;
  if (!eventIsTest(event)) throw new Error('LIVE_STRIPE_EVENT_REJECTED');
  return event;
}

export function subscriptionDetails(subscription: Record<string, unknown>, founderPrice: string, standardPrice: string) {
  requireTestStripeObject(subscription, 'subscription');
  // Stripe's current Subscription response exposes the billing period on the
  // SubscriptionItem. Keep the root-level fallback for older API versions.
  const items = ((subscription.items as { data?: unknown[] } | undefined)?.data ?? []) as Array<{
    price?: Record<string, unknown> | null;
    current_period_end?: unknown;
  }>;
  if (items.length !== 1) throw new Error('AMBIGUOUS_SUBSCRIPTION_ITEMS');
  const priceId = allowedMonthlyPriceId(items, founderPrice, standardPrice);
  if (!priceId) throw new Error('INVALID_TEST_SUBSCRIPTION_PRICE');
  const itemPeriodEnd = Number(items[0]?.current_period_end ?? 0);
  const legacyRootPeriodEnd = Number(subscription.current_period_end ?? 0);
  return {
    priceId,
    plan: priceId === founderPrice ? 'founder' : 'standard',
    customerId: String(subscription.customer ?? ''),
    subscriptionId: String(subscription.id ?? ''),
    status: String(subscription.status ?? 'unknown'),
    currentPeriodEnd: Number.isFinite(itemPeriodEnd) && itemPeriodEnd > 0 ? itemPeriodEnd : legacyRootPeriodEnd,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  };
}
