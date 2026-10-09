-- Stripe TEST billing: independently order state, subscription-period and first-payment fields.
-- This is additive and intentionally does not change operational Beauty objects.

alter table public.beauty_billing_accounts
  add column if not exists subscription_state_event_created_at timestamptz,
  add column if not exists subscription_period_event_created_at timestamptz,
  add column if not exists first_paid_event_created_at timestamptz;

create or replace function public.get_beauty_billing_access(p_business_id uuid)
returns table (subject_enrolled boolean, allowed boolean, state text, plan text, subscription_status text, grace_ends_at timestamptz, can_manage_billing boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_account public.beauty_billing_accounts%rowtype; v_owner boolean;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'Not authorized for this Beauty business' using errcode = '42501';
  end if;
  v_owner := public.has_business_role(p_business_id, array['owner']);
  if not exists (select 1 from public.beauty_billing_test_subjects s where s.business_id = p_business_id and s.enabled) then
    return query select false, true, 'not_enrolled', null::text, null::text, null::timestamptz, v_owner;
    return;
  end if;
  select * into v_account from public.beauty_billing_accounts a where a.business_id = p_business_id;
  if not found then
    return query select true, false, 'requires_payment', null::text, null::text, null::timestamptz, v_owner;
    return;
  end if;
  if v_account.subscription_status in ('active','trialing') and v_account.first_paid_at is not null then
    return query select true, true, 'active', v_account.plan_code, v_account.subscription_status, v_account.grace_ends_at, v_owner;
    return;
  end if;
  if v_account.subscription_status in ('active','trialing','incomplete','pending') then
    return query select true, false, 'pending_confirmation', v_account.plan_code, v_account.subscription_status, v_account.grace_ends_at, v_owner;
    return;
  end if;
  if v_account.subscription_status = 'past_due' and v_account.first_paid_at is not null and v_account.grace_ends_at > now() then
    return query select true, true, 'grace', v_account.plan_code, v_account.subscription_status, v_account.grace_ends_at, v_owner;
    return;
  end if;
  if v_account.subscription_status = 'past_due' and v_account.first_paid_at is not null then
    return query select true, false, 'suspended', v_account.plan_code, v_account.subscription_status, v_account.grace_ends_at, v_owner;
    return;
  end if;
  return query select true, false, 'requires_payment', v_account.plan_code, v_account.subscription_status, v_account.grace_ends_at, v_owner;
end; $$;

create or replace function public.apply_beauty_stripe_webhook(
  p_event_id text, p_event_type text, p_event_created_at timestamptz, p_business_id uuid,
  p_internal_checkout_id uuid, p_stripe_object_id text, p_stripe_customer_id text,
  p_stripe_subscription_id text, p_plan_code text, p_subscription_status text,
  p_current_period_end timestamptz, p_cancel_at_period_end boolean, p_first_paid boolean,
  p_checkout_expired boolean
) returns text language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare
  v_checkout public.beauty_billing_checkout_sessions%rowtype;
  v_account public.beauty_billing_accounts%rowtype;
  v_state_event boolean := p_event_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted');
  -- The webhook obtains p_current_period_end from a freshly retrieved, TEST-validated
  -- Subscription for these event types. invoice.paid may therefore fill a missing
  -- period, but never controls subscription state.
  v_period_event boolean := p_event_type in ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid');
  v_first_paid_event boolean := p_event_type = 'invoice.paid' and p_first_paid;
  v_apply_state boolean := false;
  v_apply_period boolean := false;
  v_duplicate boolean := false;
begin
  if p_event_id = '' or p_event_created_at is null or p_business_id is null or p_internal_checkout_id is null
     or p_plan_code not in ('founder','standard') then
    raise exception 'Invalid Stripe billing event' using errcode = '22023';
  end if;
  if not exists (select 1 from public.beauty_billing_test_subjects s where s.business_id = p_business_id and s.enabled) then
    raise exception 'Business is not a billing TEST subject' using errcode = '42501';
  end if;
  insert into public.beauty_stripe_webhook_events (stripe_event_id,event_type,stripe_created_at,business_id,stripe_object_id,processing_status,processed_at)
    values (p_event_id,p_event_type,p_event_created_at,p_business_id,p_stripe_object_id,'processed',now()) on conflict do nothing;
  -- A repeat never creates another event record. It is still reconciled through the
  -- same correlation checks so a deployment can fill missing monotonic fields from
  -- an already accepted Stripe event; state timestamps prevent any regression.
  v_duplicate := not found;

  select * into v_checkout from public.beauty_billing_checkout_sessions c
    where c.id = p_internal_checkout_id and c.business_id = p_business_id for update;
  if not found then raise exception 'Checkout does not belong to business' using errcode = '42501'; end if;
  if v_checkout.plan_code <> p_plan_code then raise exception 'Stripe price does not match checkout reservation' using errcode = '42501'; end if;

  if p_checkout_expired then
    if v_checkout.stripe_checkout_session_id is distinct from nullif(p_stripe_object_id, '') then
      raise exception 'Expired checkout session mismatch' using errcode = '42501';
    end if;
    update public.beauty_billing_checkout_sessions c set status = 'expired', updated_at = now()
      where c.id = p_internal_checkout_id and c.status in ('created','open');
    update public.beauty_founder_entitlements e set status = 'released', released_at = now(), updated_at = now()
      where e.checkout_session_id = p_internal_checkout_id and e.status = 'reserved';
    return 'expired_released';
  end if;

  if p_subscription_status not in ('active','trialing','past_due','canceled','unpaid','incomplete','incomplete_expired','paused')
     or nullif(p_stripe_customer_id,'') is null or nullif(p_stripe_subscription_id,'') is null then
    raise exception 'Invalid Stripe subscription state' using errcode = '22023';
  end if;
  if v_checkout.stripe_customer_id is not null and v_checkout.stripe_customer_id <> p_stripe_customer_id then
    raise exception 'Stripe customer mismatch' using errcode = '42501';
  end if;
  if v_checkout.stripe_subscription_id is not null and v_checkout.stripe_subscription_id <> p_stripe_subscription_id then
    raise exception 'Stripe subscription mismatch' using errcode = '42501';
  end if;
  update public.beauty_billing_checkout_sessions c set
    stripe_customer_id = coalesce(c.stripe_customer_id, nullif(p_stripe_customer_id,'')),
    stripe_subscription_id = coalesce(c.stripe_subscription_id, nullif(p_stripe_subscription_id,'')),
    status = case when c.status in ('created','open') then 'completed' else c.status end,
    completed_at = case when c.status in ('created','open') then now() else c.completed_at end,
    updated_at = now()
    where c.id = p_internal_checkout_id;

  insert into public.beauty_billing_accounts (
    business_id, stripe_customer_id, stripe_subscription_id, plan_code, subscription_status,
    current_period_end, cancel_at_period_end, first_paid_at, past_due_since, grace_ends_at, last_stripe_event_created_at,
    subscription_state_event_created_at, subscription_period_event_created_at, first_paid_event_created_at
  ) values (
    p_business_id, p_stripe_customer_id, p_stripe_subscription_id, p_plan_code,
    case when v_state_event then p_subscription_status else 'pending' end,
    case when v_period_event and p_current_period_end is not null then p_current_period_end else null end,
    case when v_state_event then coalesce(p_cancel_at_period_end,false) else false end,
    case when v_first_paid_event then p_event_created_at else null end,
    case when v_state_event and p_subscription_status = 'past_due' then p_event_created_at else null end,
    case when v_state_event and p_subscription_status = 'past_due' then p_event_created_at + interval '7 days' else null end,
    p_event_created_at,
    case when v_state_event then p_event_created_at else null end,
    case when v_period_event and p_current_period_end is not null then p_event_created_at else null end,
    case when v_first_paid_event then p_event_created_at else null end
  ) on conflict (business_id) do nothing;

  select * into v_account from public.beauty_billing_accounts a where a.business_id = p_business_id for update;
  if v_account.stripe_customer_id is not null and v_account.stripe_customer_id <> p_stripe_customer_id then
    raise exception 'Stripe customer mismatch' using errcode = '42501';
  end if;
  if v_account.stripe_subscription_id is not null and v_account.stripe_subscription_id <> p_stripe_subscription_id then
    raise exception 'Stripe subscription mismatch' using errcode = '42501';
  end if;
  v_apply_state := v_state_event and (
    v_account.subscription_state_event_created_at is null
    or p_event_created_at >= v_account.subscription_state_event_created_at
  );
  v_apply_period := v_period_event and p_current_period_end is not null and (
    v_account.current_period_end is null
    or v_account.subscription_period_event_created_at is null
    or p_event_created_at >= v_account.subscription_period_event_created_at
  );

  update public.beauty_billing_accounts a set
    stripe_customer_id = coalesce(a.stripe_customer_id, p_stripe_customer_id),
    stripe_subscription_id = coalesce(a.stripe_subscription_id, p_stripe_subscription_id),
    plan_code = coalesce(a.plan_code, p_plan_code),
    subscription_status = case when v_apply_state then p_subscription_status else a.subscription_status end,
    cancel_at_period_end = case when v_apply_state then coalesce(p_cancel_at_period_end,false) else a.cancel_at_period_end end,
    subscription_state_event_created_at = case when v_apply_state then p_event_created_at else a.subscription_state_event_created_at end,
    current_period_end = case when v_apply_period then p_current_period_end else a.current_period_end end,
    subscription_period_event_created_at = case when v_apply_period then p_event_created_at else a.subscription_period_event_created_at end,
    first_paid_at = case when v_first_paid_event then coalesce(a.first_paid_at, p_event_created_at) else a.first_paid_at end,
    first_paid_event_created_at = case when v_first_paid_event then coalesce(a.first_paid_event_created_at, p_event_created_at) else a.first_paid_event_created_at end,
    past_due_since = case
      when not v_apply_state then a.past_due_since
      when p_subscription_status = 'past_due' and a.subscription_status is distinct from 'past_due' then p_event_created_at
      when p_subscription_status in ('active','trialing') then null
      else a.past_due_since
    end,
    grace_ends_at = case
      when not v_apply_state then a.grace_ends_at
      when p_subscription_status = 'past_due' and a.subscription_status is distinct from 'past_due' then p_event_created_at + interval '7 days'
      when p_subscription_status in ('active','trialing') then null
      else a.grace_ends_at
    end,
    last_stripe_event_created_at = case
      when a.last_stripe_event_created_at is null or p_event_created_at > a.last_stripe_event_created_at then p_event_created_at
      else a.last_stripe_event_created_at
    end,
    updated_at = now()
    where a.business_id = p_business_id;

  if v_first_paid_event and p_plan_code = 'founder' then
    update public.beauty_founder_entitlements e set status = 'confirmed', stripe_subscription_id = p_stripe_subscription_id,
      confirmed_at = coalesce(e.confirmed_at, now()), expires_at = null, updated_at = now()
      from public.beauty_billing_checkout_sessions c
      where e.checkout_session_id = c.id and e.business_id = p_business_id and e.status = 'reserved'
        and c.id = p_internal_checkout_id and c.business_id = p_business_id and c.plan_code = 'founder'
        and c.stripe_customer_id = p_stripe_customer_id and c.stripe_subscription_id = p_stripe_subscription_id;
    if not found and not exists (
      select 1 from public.beauty_founder_entitlements e
      join public.beauty_billing_checkout_sessions c on c.id = e.checkout_session_id
      where e.business_id = p_business_id and e.status = 'confirmed'
        and e.stripe_subscription_id = p_stripe_subscription_id
        and c.id = p_internal_checkout_id and c.business_id = p_business_id and c.plan_code = 'founder'
        and c.stripe_customer_id = p_stripe_customer_id and c.stripe_subscription_id = p_stripe_subscription_id
    ) then
      raise exception 'Founder reservation correlation missing' using errcode = '23514';
    end if;
  end if;
  return case when v_duplicate then 'duplicate_reconciled' else 'processed' end;
end; $$;
