import { customerDetails, json, prices, requireTestStripeObject, serverClient, stripeGet, subscriptionDetails, verifyStripeTestSignature } from '../_shared/beautyBilling.ts';

type StripeObject = Record<string, unknown>;
type BillingSubject = { businessId: string; expectedPlan: 'founder' | 'standard'; internalCheckoutId: string };

function invoiceSubscriptionId(invoice: StripeObject) {
  const direct = String(invoice.subscription ?? '');
  if (direct) return direct;
  const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  return String(parent?.subscription_details?.subscription ?? '');
}

async function checkoutSubject(client: ReturnType<typeof serverClient>, checkoutSessionId: string) {
  const checkout = await client.from('beauty_billing_checkout_sessions')
    .select('id,business_id,plan_code').eq('stripe_checkout_session_id', checkoutSessionId).maybeSingle();
  if (!checkout.data?.business_id || !checkout.data.id || !['founder', 'standard'].includes(String(checkout.data.plan_code))) return null;
  return { businessId: String(checkout.data.business_id), expectedPlan: String(checkout.data.plan_code) as BillingSubject['expectedPlan'], internalCheckoutId: String(checkout.data.id) };
}

async function findBillingSubject(client: ReturnType<typeof serverClient>, checkoutSessionId: string, subscriptionId: string, internalCheckoutId = ''): Promise<BillingSubject> {
  if (checkoutSessionId) {
    const subject = await checkoutSubject(client, checkoutSessionId);
    if (subject) return subject;
  }
  if (subscriptionId) {
    const checkout = await client.from('beauty_billing_checkout_sessions')
      .select('id,business_id,plan_code').eq('stripe_subscription_id', subscriptionId).maybeSingle();
    if (checkout.data?.business_id && checkout.data.id && ['founder', 'standard'].includes(String(checkout.data.plan_code))) {
      return { businessId: String(checkout.data.business_id), expectedPlan: String(checkout.data.plan_code) as BillingSubject['expectedPlan'], internalCheckoutId: String(checkout.data.id) };
    }
    const account = await client.from('beauty_billing_accounts').select('business_id,plan_code').eq('stripe_subscription_id', subscriptionId).maybeSingle();
    if (account.data?.business_id && internalCheckoutId) {
      const checkoutByInternal = await client.from('beauty_billing_checkout_sessions').select('id,business_id,plan_code').eq('id', internalCheckoutId).maybeSingle();
      if (checkoutByInternal.data?.business_id === account.data.business_id) return { businessId: String(account.data.business_id), expectedPlan: String(account.data.plan_code) as BillingSubject['expectedPlan'], internalCheckoutId };
    }
  }
  if (internalCheckoutId) {
    const checkout = await client.from('beauty_billing_checkout_sessions').select('id,business_id,plan_code').eq('id', internalCheckoutId).maybeSingle();
    if (checkout.data?.business_id && checkout.data.id && ['founder', 'standard'].includes(String(checkout.data.plan_code))) {
      return { businessId: String(checkout.data.business_id), expectedPlan: String(checkout.data.plan_code) as BillingSubject['expectedPlan'], internalCheckoutId: String(checkout.data.id) };
    }
  }
  throw new Error('UNKNOWN_BILLING_SUBJECT');
}

function isoEventTime(value: unknown) {
  const created = Number(value ?? 0);
  if (!Number.isFinite(created) || created <= 0) throw new Error('INVALID_STRIPE_EVENT_TIME');
  return new Date(created * 1000).toISOString();
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const raw = await request.text();
    const event = await verifyStripeTestSignature(raw, request.headers.get('stripe-signature'));
    const eventId = String(event.id ?? ''); const eventType = String(event.type ?? '');
    if (!eventId || !eventType) throw new Error('INVALID_STRIPE_EVENT');
    const object = ((event.data as { object?: StripeObject } | undefined)?.object ?? {}) as StripeObject;
    const client = serverClient(); const { founderPrice, standardPrice } = prices();
    let checkoutId = ''; let subscriptionId = ''; let customerId = ''; let subject: BillingSubject;
    let plan: 'founder' | 'standard'; let status = 'incomplete'; let periodEnd: string | null = null;
    let cancelAtPeriodEnd = false; let firstPaid = false; let expired = false;

    if (eventType === 'checkout.session.expired' || eventType === 'checkout.session.async_payment_failed') {
      checkoutId = String(object.id ?? '');
      const session = requireTestStripeObject(await stripeGet(`checkout/sessions/${encodeURIComponent(checkoutId)}`), 'checkout_session');
      subject = await findBillingSubject(client, String(session.id ?? checkoutId), '');
      plan = subject.expectedPlan;
      expired = true;
    } else if (eventType === 'checkout.session.completed' || eventType === 'checkout.session.async_payment_succeeded') {
      checkoutId = String(object.id ?? '');
      const session = requireTestStripeObject(await stripeGet(`checkout/sessions/${encodeURIComponent(checkoutId)}?expand[]=subscription`), 'checkout_session');
      subscriptionId = typeof session.subscription === 'object' ? String((session.subscription as StripeObject).id ?? '') : String(session.subscription ?? '');
      customerId = String(session.customer ?? '');
      if (!subscriptionId || !customerId) throw new Error('INCOMPLETE_CHECKOUT_SESSION');
      subject = await findBillingSubject(client, String(session.id ?? checkoutId), subscriptionId);
      customerDetails(await stripeGet(`customers/${encodeURIComponent(customerId)}`));
      const details = subscriptionDetails(await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}`), founderPrice, standardPrice);
      if (details.customerId !== customerId || subject.expectedPlan !== details.plan) throw new Error('STRIPE_CHECKOUT_CORRELATION_MISMATCH');
      plan = details.plan; status = details.status; periodEnd = details.currentPeriodEnd ? new Date(details.currentPeriodEnd * 1000).toISOString() : null; cancelAtPeriodEnd = details.cancelAtPeriodEnd;
    } else if (eventType.startsWith('customer.subscription.')) {
      subscriptionId = String(object.id ?? '');
      const subscription = await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}`);
      const details = subscriptionDetails(subscription, founderPrice, standardPrice);
      customerId = details.customerId; customerDetails(await stripeGet(`customers/${encodeURIComponent(customerId)}`));
      const internalCheckoutId = String((subscription.metadata as Record<string, unknown> | undefined)?.checkout_id ?? '');
      subject = await findBillingSubject(client, '', subscriptionId, internalCheckoutId);
      if (subject.expectedPlan !== details.plan) throw new Error('STRIPE_PRICE_PLAN_MISMATCH');
      plan = details.plan; status = details.status; periodEnd = details.currentPeriodEnd ? new Date(details.currentPeriodEnd * 1000).toISOString() : null; cancelAtPeriodEnd = details.cancelAtPeriodEnd;
    } else if (eventType === 'invoice.paid' || eventType === 'invoice.payment_failed') {
      const invoice = requireTestStripeObject(await stripeGet(`invoices/${encodeURIComponent(String(object.id ?? ''))}?expand[]=lines.data.price`), 'invoice');
      subscriptionId = invoiceSubscriptionId(invoice); customerId = String(invoice.customer ?? '');
      if (!subscriptionId || !customerId) throw new Error('INVOICE_WITHOUT_SUBSCRIPTION');
      customerDetails(await stripeGet(`customers/${encodeURIComponent(customerId)}`));
      const subscription = await stripeGet(`subscriptions/${encodeURIComponent(subscriptionId)}`);
      const details = subscriptionDetails(subscription, founderPrice, standardPrice);
      if (details.customerId !== customerId) throw new Error('STRIPE_CUSTOMER_MISMATCH');
      const internalCheckoutId = String((subscription.metadata as Record<string, unknown> | undefined)?.checkout_id ?? '');
      subject = await findBillingSubject(client, '', subscriptionId, internalCheckoutId);
      if (subject.expectedPlan !== details.plan) throw new Error('STRIPE_PRICE_PLAN_MISMATCH');
      plan = details.plan; status = details.status; periodEnd = details.currentPeriodEnd ? new Date(details.currentPeriodEnd * 1000).toISOString() : null; cancelAtPeriodEnd = details.cancelAtPeriodEnd;
      firstPaid = eventType === 'invoice.paid' && String(invoice.billing_reason ?? '') === 'subscription_create';
    } else return json(200, { received: true, ignored: true });

    const applied = await client.rpc('apply_beauty_stripe_webhook', {
      p_event_id: eventId, p_event_type: eventType, p_event_created_at: isoEventTime(event.created),
      p_business_id: subject.businessId, p_internal_checkout_id: subject.internalCheckoutId,
      p_stripe_object_id: checkoutId || subscriptionId || String(object.id ?? ''), p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscriptionId, p_plan_code: plan, p_subscription_status: status,
      p_current_period_end: periodEnd, p_cancel_at_period_end: cancelAtPeriodEnd,
      p_first_paid: firstPaid, p_checkout_expired: expired,
    });
    if (applied.error) throw applied.error;
    return json(200, { received: true, status: applied.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'WEBHOOK_FAILED';
    return json(message.includes('SIGNATURE') || message.includes('LIVE_OR_UNKNOWN') ? 400 : 502, { error: message });
  }
});
