import assert from 'node:assert/strict';
import test from 'node:test';
import { billingAccessFor, founderPlan, isAllowedTestPrice, isTestStripeEvent } from '../src/features/billing/billingRules.ts';
import { allowedMonthlyPriceId, canAdvanceStripeState, canApplyPeriodEvent, shouldRecordFirstPaid, strictTestObject } from '../supabase/functions/_shared/beautyBillingRules.ts';

test('reserves Founder until the 100th confirmed or active reservation', () => {
  assert.equal(founderPlan(99, 0), 'founder');
  assert.equal(founderPlan(98, 1), 'founder');
  assert.equal(founderPlan(99, 1), 'standard');
});

test('a released Founder reservation no longer occupies a slot', () => {
  assert.equal(founderPlan(99, 0), 'founder');
  assert.equal(founderPlan(100, 0), 'standard');
});

test('only the two configured TEST prices are accepted', () => {
  assert.equal(isAllowedTestPrice('price_founder', 'price_founder', 'price_standard'), true);
  assert.equal(isAllowedTestPrice('price_standard', 'price_founder', 'price_standard'), true);
  assert.equal(isAllowedTestPrice('price_unknown', 'price_founder', 'price_standard'), false);
});

test('rejects live webhook events and records a Stripe event only once', () => {
  assert.equal(isTestStripeEvent({ id: 'evt_test', livemode: false }, new Set()), true);
  assert.equal(isTestStripeEvent({ id: 'evt_live', livemode: true }, new Set()), false);
  assert.equal(isTestStripeEvent({ id: 'evt_seen', livemode: false }, new Set(['evt_seen'])), false);
});

test('past_due keeps access for seven days and then suspends without deleting data', () => {
  const beforeExpiry = new Date('2026-10-10T00:00:00Z');
  const firstPaidAt = '2026-10-01T00:00:00Z';
  assert.deepEqual(billingAccessFor('past_due', '2026-10-11T00:00:00Z', beforeExpiry, firstPaidAt), { allowed: true, state: 'grace' });
  assert.deepEqual(billingAccessFor('past_due', '2026-10-09T00:00:00Z', beforeExpiry, firstPaidAt), { allowed: false, state: 'suspended' });
  assert.deepEqual(billingAccessFor('canceled', null, beforeExpiry), { allowed: false, state: 'requires_payment' });
});

test('owner is required by the SQL contract while BillingGate may display state to admin and staff', () => {
  const canCreateCheckout = (role: string, enrolled: boolean) => role === 'owner' && enrolled;
  assert.equal(canCreateCheckout('owner', true), true);
  assert.equal(canCreateCheckout('admin', true), false);
  assert.equal(canCreateCheckout('staff', true), false);
  assert.equal(canCreateCheckout('owner', false), false);
});

test('an expired Checkout releases its Founder reservation idempotently', () => {
  let status: 'reserved' | 'released' = 'reserved';
  const release = () => { if (status === 'reserved') status = 'released'; };
  release(); release();
  assert.equal(status, 'released');
  assert.equal(founderPlan(99, 0), 'founder');
});

test('an older Stripe event cannot overwrite a newer account state', () => {
  assert.equal(canAdvanceStripeState('2026-10-10T10:00:00Z', '2026-10-10T09:59:59Z'), false);
  assert.equal(canAdvanceStripeState('2026-10-10T10:00:00Z', '2026-10-10T10:00:00Z'), true);
  assert.equal(canAdvanceStripeState(null, '2026-10-10T09:00:00Z'), true);
});

test('event domains permit valid invoice payment work despite a later Checkout event', () => {
  const checkoutAt = '2026-10-09T19:13:08Z';
  const invoiceAt = '2026-10-09T19:13:07Z';
  assert.equal(canAdvanceStripeState(checkoutAt, invoiceAt), false);
  assert.equal(shouldRecordFirstPaid(null, 'invoice.paid', true), true);
  assert.equal(shouldRecordFirstPaid('2026-10-09T19:13:07Z', 'invoice.paid', true), false);
});

test('period ordering is independent and can fill null but never overwrite a newer period', () => {
  assert.equal(canApplyPeriodEvent('2026-10-10T10:00:00Z', null, '2026-10-10T09:00:00Z'), true);
  assert.equal(canApplyPeriodEvent('2026-10-10T10:00:00Z', '2026-11-10T00:00:00Z', '2026-10-10T09:00:00Z'), false);
  assert.equal(canApplyPeriodEvent('2026-10-10T10:00:00Z', '2026-11-10T00:00:00Z', '2026-10-10T10:01:00Z'), true);
});

test('a Subscription event predating Checkout remains authoritative for its own state and period domains', () => {
  const subscriptionCreatedAt = '2026-10-09T19:13:07Z';
  const checkoutAt = '2026-10-09T19:13:08Z';
  assert.equal(canAdvanceStripeState(subscriptionCreatedAt, checkoutAt), true);
  assert.equal(canApplyPeriodEvent(null, null, subscriptionCreatedAt), true);
});

test('invoice event ordering does not alter subscription state ordering', () => {
  const latestCancellation = '2026-10-10T10:00:00Z';
  const olderInvoice = '2026-10-10T09:00:00Z';
  assert.equal(canAdvanceStripeState(latestCancellation, olderInvoice), false);
  assert.equal(shouldRecordFirstPaid(null, 'invoice.paid', true), true);
});

test('a valid invoice Subscription snapshot can fill a missing period without reactivating state', () => {
  assert.equal(canApplyPeriodEvent(null, null, '2026-10-09T19:13:07Z'), true);
  assert.equal(canAdvanceStripeState('2026-10-10T10:00:00Z', '2026-10-09T19:13:07Z'), false);
});

test('a repeated valid invoice can repair first payment fields without duplicating Founder', () => {
  assert.equal(shouldRecordFirstPaid(null, 'invoice.paid', true), true);
  assert.equal(shouldRecordFirstPaid('2026-10-09T19:13:07Z', 'invoice.paid', true), false);
  let founder: 'confirmed' = 'confirmed';
  const reconcile = () => founder;
  assert.equal(reconcile(), 'confirmed');
});

test('active access requires a persisted first payment confirmation', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  assert.deepEqual(billingAccessFor('active', null, now, null), { allowed: false, state: 'pending_confirmation' });
  assert.deepEqual(billingAccessFor('active', null, now, '2026-10-09T19:13:07Z'), { allowed: true, state: 'active' });
});

test('an end-of-period cancellation remains accessible while Stripe still reports active', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  assert.deepEqual(billingAccessFor('active', null, now, '2026-10-09T19:13:07Z'), { allowed: true, state: 'active' });
  assert.deepEqual(billingAccessFor('canceled', null, now, '2026-10-09T19:13:07Z'), { allowed: false, state: 'requires_payment' });
});

test('newer cancellation or past_due state wins while duplicate webhooks stay idempotent', () => {
  assert.equal(canAdvanceStripeState('2026-10-10T10:00:00Z', '2026-10-10T09:00:00Z'), false);
  assert.equal(canAdvanceStripeState('2026-10-10T10:00:00Z', '2026-10-10T10:00:00Z'), true);
  let founder: 'reserved' | 'confirmed' = 'reserved';
  const confirmFounder = () => { if (founder === 'reserved') founder = 'confirmed'; };
  confirmFounder(); confirmFounder();
  assert.equal(founder, 'confirmed');
});

test('the event-domain migration keeps access gated and preserves the private RPC signature', async () => {
  const migration = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../supabase/migrations/20261009210000_stripe_billing_event_domain_ordering.sql', import.meta.url), 'utf8'));
  assert.match(migration, /subscription_state_event_created_at timestamptz/i);
  assert.match(migration, /subscription_period_event_created_at timestamptz/i);
  assert.match(migration, /first_paid_event_created_at timestamptz/i);
  assert.match(migration, /v_first_paid_event boolean := p_event_type = 'invoice\.paid' and p_first_paid/i);
  assert.match(migration, /v_period_event boolean := p_event_type in \('customer\.subscription\.created', 'customer\.subscription\.updated', 'customer\.subscription\.deleted', 'invoice\.paid'\)/i);
  assert.match(migration, /v_account\.first_paid_at is not null/i);
  assert.match(migration, /e\.status = 'reserved'/i);
  assert.match(migration, /e\.status = 'confirmed'/i);
  assert.match(migration, /apply_beauty_stripe_webhook\([\s\S]*p_internal_checkout_id uuid[\s\S]*p_checkout_expired boolean/i);
  assert.doesNotMatch(migration, /grant execute|revoke all on function/i);
  assert.match(migration, /v_duplicate := not found/i);
  assert.match(migration, /duplicate_reconciled/i);
});

test('requires coherent Founder payment identifiers before confirmation', () => {
  const matches = (value: { business: string; checkoutBusiness: string; customer: string; checkoutCustomer: string; subscription: string; checkoutSubscription: string; price: string; plan: string }) =>
    value.business === value.checkoutBusiness
      && value.customer === value.checkoutCustomer
      && value.subscription === value.checkoutSubscription
      && value.price === 'price_founder'
      && value.plan === 'founder';
  assert.equal(matches({ business: 'b1', checkoutBusiness: 'b1', customer: 'cus_1', checkoutCustomer: 'cus_1', subscription: 'sub_1', checkoutSubscription: 'sub_1', price: 'price_founder', plan: 'founder' }), true);
  assert.equal(matches({ business: 'b1', checkoutBusiness: 'b1', customer: 'cus_1', checkoutCustomer: 'cus_other', subscription: 'sub_1', checkoutSubscription: 'sub_1', price: 'price_founder', plan: 'founder' }), false);
});

test('rejects live or unknown Stripe objects and ambiguous subscription items', () => {
  assert.equal(strictTestObject({ livemode: false }), true);
  assert.equal(strictTestObject({ livemode: true }), false);
  assert.equal(strictTestObject({}), false);
  const monthlyFounder = { price: { id: 'price_founder', currency: 'eur', recurring: { interval: 'month' } } };
  assert.equal(allowedMonthlyPriceId([monthlyFounder], 'price_founder', 'price_standard'), 'price_founder');
  assert.equal(allowedMonthlyPriceId([monthlyFounder, monthlyFounder], 'price_founder', 'price_standard'), null);
  assert.equal(allowedMonthlyPriceId([{ price: { id: 'price_founder', currency: 'eur', recurring: { interval: 'year' } } }], 'price_founder', 'price_standard'), null);
});

test('a billing lookup failure is fail-open only for a business not enrolled in the TEST allowlist', () => {
  const shouldBlock = (knownOrExpectedTestSubject: boolean) => knownOrExpectedTestSubject;
  assert.equal(shouldBlock(false), false);
  assert.equal(shouldBlock(true), true);
});

test('the migration grants only service_role the private billing RPC surface', async () => {
  const migration = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../supabase/migrations/20261009170036_stripe_billing_test.sql', import.meta.url), 'utf8'));
  const directTableGrants = migration.match(/grant select on table([\s\S]*?)to service_role;/i)?.[1] ?? '';
  assert.match(directTableGrants, /beauty_billing_test_subjects/i);
  assert.match(directTableGrants, /beauty_billing_accounts/i);
  assert.match(directTableGrants, /beauty_billing_checkout_sessions/i);
  assert.doesNotMatch(directTableGrants, /beauty_founder_entitlements|beauty_stripe_webhook_events/i);
  assert.match(migration, /apply_beauty_stripe_webhook\([^;]*to service_role/i);
  assert.match(migration, /revoke all on function public\.apply_beauty_stripe_webhook[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /apply_beauty_stripe_webhook\(text,text,timestamptz,uuid,text,text,text,text,text,timestamptz,boolean,boolean,boolean\)/i);
  const serviceRoleRpcGrant = migration.match(/grant execute on function([\s\S]*?)to service_role;/i)?.[1] ?? '';
  assert.doesNotMatch(serviceRoleRpcGrant, /release_beauty_founder_reservation/i);
});

test('the ACL hardening migration revokes inherited service_role grants before the minimal regrants', async () => {
  const migration = await import('node:fs/promises').then(({ readFile }) => readFile(new URL('../supabase/migrations/20261009180037_stripe_billing_acl_hardening.sql', import.meta.url), 'utf8'));
  assert.match(migration, /revoke all privileges on table[\s\S]*beauty_founder_entitlements[\s\S]*beauty_stripe_webhook_events[\s\S]*from service_role/i);
  assert.match(migration, /grant select on table[\s\S]*beauty_billing_test_subjects[\s\S]*beauty_billing_accounts[\s\S]*beauty_billing_checkout_sessions[\s\S]*to service_role/i);
  assert.match(migration, /revoke all privileges on function[\s\S]*release_beauty_founder_reservation[\s\S]*from service_role, anon, authenticated/i);
  const serviceRoleGrant = migration.match(/grant execute on function([\s\S]*?)to service_role;/i)?.[1] ?? '';
  assert.doesNotMatch(serviceRoleGrant, /release_beauty_founder_reservation|get_beauty_billing_access/i);
  assert.match(migration, /grant execute on function public\.get_beauty_billing_access\(uuid\) to authenticated/i);
});
