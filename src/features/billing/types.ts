import type { BillingPlan, BillingSubscriptionStatus } from './billingRules';

export type BillingAccess = {
  subjectEnrolled: boolean;
  allowed: boolean;
  state: 'not_enrolled' | 'requires_payment' | 'pending_confirmation' | 'active' | 'grace' | 'suspended';
  plan: BillingPlan | null;
  subscriptionStatus: BillingSubscriptionStatus;
  graceEndsAt: string | null;
  canManageBilling: boolean;
};
