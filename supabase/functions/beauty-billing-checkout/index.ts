import { checkoutSessionDetails, customerDetails, json, options, prices, requireTestOwner, requireUser, serverClient, stripeGet, stripeRequest } from '../_shared/beautyBilling.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return options();
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const client = serverClient(); const user = await requireUser(request, client);
    const body = await request.json() as { businessId?: unknown }; const businessId = String(body.businessId ?? '');
    await requireTestOwner(client, businessId, user.id);
    const reserved = await client.rpc('reserve_beauty_billing_checkout', { p_business_id: businessId, p_user_id: user.id });
    if (reserved.error || !reserved.data?.[0]) return json(502, { error: 'BILLING_RESERVATION_FAILED' });
    const row = reserved.data[0] as { checkout_id: string; plan_code: 'founder' | 'standard'; expires_at: string };
    const { founderPrice, standardPrice } = prices(); const appUrl = Deno.env.get('AURA_TEST_APP_URL');
    if (!appUrl?.startsWith('https://')) throw new Error('AURA_TEST_APP_URL_MISSING');
    const account = await client.from('beauty_billing_accounts').select('stripe_customer_id').eq('business_id', businessId).maybeSingle();
    const form = new URLSearchParams({ mode: 'subscription', success_url: `${appUrl}/billing/return?checkout=success&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${appUrl}/billing/return?checkout=cancelled`, client_reference_id: businessId, 'line_items[0][price]': row.plan_code === 'founder' ? founderPrice : standardPrice, 'line_items[0][quantity]': '1', 'metadata[business_id]': businessId, 'metadata[checkout_id]': row.checkout_id, 'metadata[plan]': row.plan_code, 'subscription_data[metadata][business_id]': businessId, 'subscription_data[metadata][checkout_id]': row.checkout_id, 'automatic_tax[enabled]': 'false' });
    if (account.data?.stripe_customer_id) {
      const customer = customerDetails(await stripeGet(`customers/${encodeURIComponent(String(account.data.stripe_customer_id))}`));
      form.set('customer', customer.id);
    } else if (user.email) form.set('customer_email', user.email);
    else throw new Error('CUSTOMER_EMAIL_REQUIRED');
    let session: Record<string, unknown>;
    try { session = await stripeRequest('checkout/sessions', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `aura-test-checkout-${row.checkout_id}` }, body: form }); }
    catch (caught) { await client.rpc('release_beauty_billing_checkout', { p_checkout_id: row.checkout_id }); throw caught; }
    const checkout = checkoutSessionDetails(session);
    const bind = await client.rpc('bind_beauty_billing_checkout_session', { p_checkout_id: row.checkout_id, p_stripe_session_id: checkout.id, p_stripe_customer_id: checkout.customerId, p_expires_at: new Date(checkout.expiresAt * 1000).toISOString() });
    if (bind.error) throw new Error('BILLING_BIND_FAILED');
    return json(200, { url: checkout.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'BILLING_CHECKOUT_FAILED';
    return json(message === 'UNAUTHENTICATED' ? 401 : message.includes('PERMISSION') || message.includes('NOT_ENABLED') ? 403 : 502, { error: message });
  }
});
