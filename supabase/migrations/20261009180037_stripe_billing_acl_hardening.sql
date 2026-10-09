-- Stripe Billing TEST ACL hardening. This migration is intentionally additive:
-- it corrects Supabase's default service_role grants without changing schema,
-- policies, operational AURA objects, or the previously applied base migration.

revoke all privileges on table
  public.beauty_billing_test_subjects,
  public.beauty_billing_accounts,
  public.beauty_billing_checkout_sessions,
  public.beauty_founder_entitlements,
  public.beauty_stripe_webhook_events
from service_role;

grant select on table
  public.beauty_billing_test_subjects,
  public.beauty_billing_accounts,
  public.beauty_billing_checkout_sessions
to service_role;

revoke all privileges on table
  public.beauty_billing_test_subjects,
  public.beauty_billing_accounts,
  public.beauty_billing_checkout_sessions,
  public.beauty_founder_entitlements,
  public.beauty_stripe_webhook_events
from anon, authenticated;

revoke all privileges on function
  public.reserve_beauty_billing_checkout(uuid, uuid),
  public.bind_beauty_billing_checkout_session(uuid, text, text, timestamptz),
  public.release_beauty_founder_reservation(text),
  public.release_beauty_billing_checkout(uuid),
  public.apply_beauty_stripe_webhook(text, text, timestamptz, uuid, uuid, text, text, text, text, text, timestamptz, boolean, boolean, boolean),
  public.get_beauty_billing_access(uuid)
from service_role, anon, authenticated;

grant execute on function
  public.reserve_beauty_billing_checkout(uuid, uuid),
  public.bind_beauty_billing_checkout_session(uuid, text, text, timestamptz),
  public.release_beauty_billing_checkout(uuid),
  public.apply_beauty_stripe_webhook(text, text, timestamptz, uuid, uuid, text, text, text, text, text, timestamptz, boolean, boolean, boolean)
to service_role;

grant execute on function public.get_beauty_billing_access(uuid) to authenticated;
