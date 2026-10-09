export const founderLimit = 100;
export const testSubscriptionStatuses = new Set(['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']);

export function chooseTestPlan(confirmed: number, reservations: number) {
  return confirmed + reservations < founderLimit ? 'founder' as const : 'standard' as const;
}

export function validTestPrice(priceId: string, founderPriceId: string, standardPriceId: string) {
  return priceId === founderPriceId || priceId === standardPriceId;
}

export function eventIsTest(event: { livemode?: unknown }) {
  return event.livemode === false;
}

export function strictTestObject(value: { livemode?: unknown }) {
  return value.livemode === false;
}

export function allowedMonthlyPriceId(items: unknown, founderPriceId: string, standardPriceId: string) {
  if (!Array.isArray(items) || items.length !== 1) return null;
  const price = (items[0] as { price?: Record<string, unknown> } | undefined)?.price;
  const priceId = String(price?.id ?? '');
  const recurring = price?.recurring as Record<string, unknown> | undefined;
  if (recurring?.interval !== 'month' || String(price?.currency ?? '').toLowerCase() !== 'eur') return null;
  return validTestPrice(priceId, founderPriceId, standardPriceId) ? priceId : null;
}

export function canAdvanceStripeState(lastEventCreatedAt: string | null, eventCreatedAt: string) {
  return !lastEventCreatedAt || new Date(eventCreatedAt).getTime() >= new Date(lastEventCreatedAt).getTime();
}

export function canApplyPeriodEvent(lastPeriodEventCreatedAt: string | null, currentPeriodEnd: string | null, eventCreatedAt: string) {
  return !currentPeriodEnd || !lastPeriodEventCreatedAt || canAdvanceStripeState(lastPeriodEventCreatedAt, eventCreatedAt);
}

export function shouldRecordFirstPaid(firstPaidAt: string | null, eventType: string, isFirstSubscriptionInvoice: boolean) {
  return !firstPaidAt && eventType === 'invoice.paid' && isFirstSubscriptionInvoice;
}
