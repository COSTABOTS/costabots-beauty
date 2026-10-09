export type BillingPlan = 'founder' | 'standard';
export type BillingSubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused'
  | 'unknown'
  | null;

export function billingAccessFor(status: BillingSubscriptionStatus, graceEndsAt: string | null, now = new Date(), firstPaidAt: string | null = null) {
  if ((status === 'active' || status === 'trialing') && firstPaidAt) return { allowed: true, state: 'active' as const };
  if (status === 'active' || status === 'trialing') return { allowed: false, state: 'pending_confirmation' as const };
  if (status === 'past_due' && graceEndsAt && new Date(graceEndsAt).getTime() > now.getTime()) {
    return { allowed: true, state: 'grace' as const };
  }
  if (status === 'past_due') return { allowed: false, state: 'suspended' as const };
  return { allowed: false, state: 'requires_payment' as const };
}

export function founderPlan(confirmed: number, activeReservations: number): BillingPlan {
  return confirmed + activeReservations < 100 ? 'founder' : 'standard';
}

export function isAllowedTestPrice(priceId: string, founderPriceId: string, standardPriceId: string) {
  return priceId === founderPriceId || priceId === standardPriceId;
}

export function isTestStripeEvent(event: { livemode?: unknown; id?: unknown }, seenEventIds: ReadonlySet<string>) {
  return event.livemode === false && typeof event.id === 'string' && event.id.length > 0 && !seenEventIds.has(event.id);
}

export function shouldBlockOnBillingLookupError(isKnownOrExpectedTestSubject: boolean) {
  return isKnownOrExpectedTestSubject;
}
