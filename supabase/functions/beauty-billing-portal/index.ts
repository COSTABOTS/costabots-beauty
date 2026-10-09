import { customerDetails, json, options, requireTestOwner, requireUser, serverClient, stripeGet, stripeRequest } from '../_shared/beautyBilling.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return options();
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const client = serverClient(); const user = await requireUser(request, client);
    const businessId = String((await request.json() as { businessId?: unknown }).businessId ?? '');
    await requireTestOwner(client, businessId, user.id);
    const account = await client.from('beauty_billing_accounts').select('stripe_customer_id').eq('business_id', businessId).maybeSingle();
    const customer = String(account.data?.stripe_customer_id ?? ''); const appUrl = Deno.env.get('AURA_TEST_APP_URL');
    if (!customer || !appUrl?.startsWith('https://')) throw new Error('BILLING_PORTAL_UNAVAILABLE');
    const verifiedCustomer = customerDetails(await stripeGet(`customers/${encodeURIComponent(customer)}`));
    const form = new URLSearchParams({ customer: verifiedCustomer.id, return_url: `${appUrl}/billing/return?portal=returned` });
    const session = await stripeRequest('billing_portal/sessions', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    if (session.livemode !== false || !String(session.url ?? '').startsWith('https://')) throw new Error('INVALID_TEST_PORTAL_SESSION');
    return json(200, { url: session.url });
  } catch (error) { return json(502, { error: error instanceof Error ? error.message : 'BILLING_PORTAL_FAILED' }); }
});
