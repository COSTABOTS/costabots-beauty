-- Stripe TEST billing. This migration creates only isolated billing objects.
-- It intentionally does not alter Beauty operational tables, policies, triggers or RPCs.

create table if not exists public.beauty_billing_test_subjects (
  business_id uuid primary key references public.beauty_businesses(id) on delete restrict,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.beauty_billing_accounts (
  business_id uuid primary key references public.beauty_businesses(id) on delete restrict,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  plan_code text check (plan_code in ('founder', 'standard')),
  subscription_status text,
  first_paid_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  past_due_since timestamptz,
  grace_ends_at timestamptz,
  -- Only Stripe event chronology may advance subscription state. Delayed events are audited but cannot regress it.
  last_stripe_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beauty_billing_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.beauty_businesses(id) on delete restrict,
  plan_code text not null check (plan_code in ('founder', 'standard')),
  stripe_checkout_session_id text unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text not null default 'created' check (status in ('created', 'open', 'completed', 'expired', 'failed')),
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists beauty_billing_checkout_sessions_business_status_idx
  on public.beauty_billing_checkout_sessions (business_id, status, expires_at desc);

create table if not exists public.beauty_founder_entitlements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.beauty_businesses(id) on delete restrict,
  checkout_session_id uuid references public.beauty_billing_checkout_sessions(id) on delete restrict,
  stripe_subscription_id text unique,
  status text not null check (status in ('reserved', 'confirmed', 'released')),
  reserved_at timestamptz,
  expires_at timestamptz,
  confirmed_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists beauty_founder_entitlements_status_expiry_idx
  on public.beauty_founder_entitlements (status, expires_at);

create table if not exists public.beauty_stripe_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  stripe_created_at timestamptz,
  business_id uuid references public.beauty_businesses(id) on delete restrict,
  stripe_object_id text,
  processing_status text not null check (processing_status in ('processed', 'ignored', 'failed')),
  processed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now()
);

alter table public.beauty_billing_test_subjects enable row level security;
alter table public.beauty_billing_test_subjects force row level security;
alter table public.beauty_billing_accounts enable row level security;
alter table public.beauty_billing_accounts force row level security;
alter table public.beauty_billing_checkout_sessions enable row level security;
alter table public.beauty_billing_checkout_sessions force row level security;
alter table public.beauty_founder_entitlements enable row level security;
alter table public.beauty_founder_entitlements force row level security;
alter table public.beauty_stripe_webhook_events enable row level security;
alter table public.beauty_stripe_webhook_events force row level security;
revoke all on table public.beauty_billing_test_subjects, public.beauty_billing_accounts,
  public.beauty_billing_checkout_sessions, public.beauty_founder_entitlements,
  public.beauty_stripe_webhook_events from anon, authenticated;

create or replace function public.reserve_beauty_billing_checkout(
  p_business_id uuid,
  p_user_id uuid
) returns table (checkout_id uuid, plan_code text, founder_entitlement_id uuid, expires_at timestamptz)
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare
  v_founder_id uuid;
  v_plan text := 'standard';
  v_expiry timestamptz := now() + interval '30 minutes';
  v_checkout_id uuid;
begin
  if not exists (select 1 from public.beauty_billing_test_subjects s where s.business_id = p_business_id and s.enabled)
    or not exists (select 1 from public.business_members bm where bm.business_id = p_business_id and bm.user_id = p_user_id and bm.active and bm.role = 'owner') then
    raise exception 'Billing TEST subject or owner permission required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(pg_hashtextextended('beauty-founder-test-slots', 0));
  update public.beauty_founder_entitlements set status = 'released', released_at = now(), updated_at = now()
    where status = 'reserved' and expires_at <= now();
  select c.id, c.plan_code, c.expires_at into v_checkout_id, v_plan, v_expiry
    from public.beauty_billing_checkout_sessions c
    where c.business_id = p_business_id and c.status in ('created', 'open') and c.expires_at > now()
    order by c.created_at desc limit 1 for update;
  if v_checkout_id is not null then
    select id into v_founder_id from public.beauty_founder_entitlements
      where checkout_session_id = v_checkout_id and status = 'reserved';
    return query select v_checkout_id, v_plan, v_founder_id, v_expiry;
    return;
  end if;
  select id into v_founder_id from public.beauty_founder_entitlements where business_id = p_business_id for update;
  if v_founder_id is not null and exists (select 1 from public.beauty_founder_entitlements where id = v_founder_id and status = 'confirmed') then
    v_plan := 'standard';
  elsif (select count(*) from public.beauty_founder_entitlements where status = 'confirmed' or (status = 'reserved' and expires_at > now())) < 100 then
    v_plan := 'founder';
  end if;
  insert into public.beauty_billing_checkout_sessions (business_id, plan_code, status, expires_at, created_by)
    values (p_business_id, v_plan, 'created', v_expiry, p_user_id) returning id into v_checkout_id;
  if v_plan = 'founder' then
    insert into public.beauty_founder_entitlements (business_id, checkout_session_id, status, reserved_at, expires_at)
      values (p_business_id, v_checkout_id, 'reserved', now(), v_expiry)
    on conflict (business_id) do update set checkout_session_id = excluded.checkout_session_id, status = 'reserved', reserved_at = now(), expires_at = v_expiry, released_at = null, updated_at = now()
    returning id into v_founder_id;
  end if;
  return query select v_checkout_id, v_plan, v_founder_id, v_expiry;
end; $$;

create or replace function public.bind_beauty_billing_checkout_session(
  p_checkout_id uuid, p_stripe_session_id text, p_stripe_customer_id text, p_expires_at timestamptz
) returns void language plpgsql volatile security definer set search_path = pg_catalog, public as $$
begin
  update public.beauty_billing_checkout_sessions set stripe_checkout_session_id = p_stripe_session_id,
    stripe_customer_id = nullif(p_stripe_customer_id, ''), status = 'open', expires_at = p_expires_at, updated_at = now()
    where id = p_checkout_id;
  if not found then raise exception 'Unknown billing checkout'; end if;
end; $$;

create or replace function public.release_beauty_founder_reservation(p_stripe_session_id text)
returns void language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_checkout_id uuid;
begin
  select id into v_checkout_id from public.beauty_billing_checkout_sessions where stripe_checkout_session_id = p_stripe_session_id for update;
  if v_checkout_id is null then return; end if;
  update public.beauty_billing_checkout_sessions set status = 'expired', updated_at = now() where id = v_checkout_id and status in ('created','open');
  update public.beauty_founder_entitlements set status = 'released', released_at = now(), updated_at = now()
    where checkout_session_id = v_checkout_id and status = 'reserved';
end; $$;

create or replace function public.release_beauty_billing_checkout(p_checkout_id uuid)
returns void language plpgsql volatile security definer set search_path = pg_catalog, public as $$
begin
  update public.beauty_billing_checkout_sessions set status = 'failed', updated_at = now()
    where id = p_checkout_id and status = 'created';
  update public.beauty_founder_entitlements set status = 'released', released_at = now(), updated_at = now()
    where checkout_session_id = p_checkout_id and status = 'reserved';
end; $$;

create or replace function public.get_beauty_billing_access(p_business_id uuid)
returns table (subject_enrolled boolean, allowed boolean, state text, plan text, subscription_status text, grace_ends_at timestamptz, can_manage_billing boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_account public.beauty_billing_accounts%rowtype; v_owner boolean;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then raise exception 'Not authorized for this Beauty business' using errcode = '42501'; end if;
  v_owner := public.has_business_role(p_business_id, array['owner']);
  if not exists (select 1 from public.beauty_billing_test_subjects where business_id = p_business_id and enabled) then
    return query select false, true, 'not_enrolled', null::text, null::text, null::timestamptz, v_owner; return;
  end if;
  select * into v_account from public.beauty_billing_accounts where business_id = p_business_id;
  if not found then return query select true, false, 'requires_payment', null::text, null::text, null::timestamptz, v_owner; return; end if;
  if v_account.subscription_status in ('active','trialing') then return query select true,true,'active',v_account.plan_code,v_account.subscription_status,v_account.grace_ends_at,v_owner; return; end if;
  if v_account.subscription_status = 'past_due' and v_account.grace_ends_at > now() then return query select true,true,'grace',v_account.plan_code,v_account.subscription_status,v_account.grace_ends_at,v_owner; return; end if;
  if v_account.subscription_status = 'past_due' then return query select true,false,'suspended',v_account.plan_code,v_account.subscription_status,v_account.grace_ends_at,v_owner; return; end if;
  if v_account.subscription_status in ('incomplete','pending') then return query select true,false,'pending_confirmation',v_account.plan_code,v_account.subscription_status,v_account.grace_ends_at,v_owner; return; end if;
  return query select true,false,'requires_payment',v_account.plan_code,v_account.subscription_status,v_account.grace_ends_at,v_owner;
end; $$;

-- Webhook contract: expiration only releases the internally correlated reservation; all other
-- events must correlate business, checkout, customer, subscription and allowed plan before state changes.
-- checkout.session.* and customer.subscription.* may advance subscription state; invoice.paid only
-- additionally establishes first payment/Founder entitlement. Older Stripe events are audit-only.
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
  v_stale boolean := false;
begin
  if p_event_id = '' or p_business_id is null or p_internal_checkout_id is null
     or p_plan_code not in ('founder','standard') then
    raise exception 'Invalid Stripe billing event' using errcode = '22023';
  end if;
  if not exists (select 1 from public.beauty_billing_test_subjects where business_id = p_business_id and enabled) then
    raise exception 'Business is not a billing TEST subject' using errcode = '42501';
  end if;
  insert into public.beauty_stripe_webhook_events (stripe_event_id,event_type,stripe_created_at,business_id,stripe_object_id,processing_status,processed_at)
    values (p_event_id,p_event_type,p_event_created_at,p_business_id,p_stripe_object_id,'processed',now()) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  select * into v_checkout from public.beauty_billing_checkout_sessions
    where id = p_internal_checkout_id and business_id = p_business_id for update;
  if not found then raise exception 'Checkout does not belong to business' using errcode = '42501'; end if;
  if v_checkout.plan_code <> p_plan_code then raise exception 'Stripe price does not match checkout reservation' using errcode = '42501'; end if;

  if p_checkout_expired then
    if v_checkout.stripe_checkout_session_id is distinct from nullif(p_stripe_object_id, '') then
      raise exception 'Expired checkout session mismatch' using errcode = '42501';
    end if;
    update public.beauty_billing_checkout_sessions set status = 'expired', updated_at = now()
      where id = p_internal_checkout_id and status in ('created','open');
    update public.beauty_founder_entitlements set status = 'released', released_at = now(), updated_at = now()
      where checkout_session_id = p_internal_checkout_id and status = 'reserved';
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
  update public.beauty_billing_checkout_sessions set
    stripe_customer_id = coalesce(stripe_customer_id, nullif(p_stripe_customer_id,'')),
    stripe_subscription_id = coalesce(stripe_subscription_id, nullif(p_stripe_subscription_id,'')),
    status = case when status in ('created','open') then 'completed' else status end,
    completed_at = case when status in ('created','open') then now() else completed_at end,
    updated_at = now()
    where id = p_internal_checkout_id;

  select * into v_account from public.beauty_billing_accounts where business_id = p_business_id for update;
  if found and v_account.stripe_customer_id is not null and v_account.stripe_customer_id <> p_stripe_customer_id then
    raise exception 'Stripe customer mismatch' using errcode = '42501';
  end if;
  if found and v_account.stripe_subscription_id is not null and v_account.stripe_subscription_id <> p_stripe_subscription_id then
    raise exception 'Stripe subscription mismatch' using errcode = '42501';
  end if;
  v_stale := found and v_account.last_stripe_event_created_at is not null
    and p_event_created_at < v_account.last_stripe_event_created_at;
  if not v_stale then
    insert into public.beauty_billing_accounts (business_id,stripe_customer_id,stripe_subscription_id,plan_code,subscription_status,current_period_end,cancel_at_period_end,first_paid_at,last_stripe_event_created_at)
      values (p_business_id,p_stripe_customer_id,p_stripe_subscription_id,p_plan_code,p_subscription_status,p_current_period_end,coalesce(p_cancel_at_period_end,false),case when p_first_paid then now() end,p_event_created_at)
    on conflict (business_id) do update set
      stripe_customer_id = coalesce(beauty_billing_accounts.stripe_customer_id, excluded.stripe_customer_id),
      stripe_subscription_id = coalesce(excluded.stripe_subscription_id, beauty_billing_accounts.stripe_subscription_id),
      plan_code = excluded.plan_code, subscription_status = excluded.subscription_status,
      current_period_end = excluded.current_period_end, cancel_at_period_end = excluded.cancel_at_period_end,
      first_paid_at = coalesce(beauty_billing_accounts.first_paid_at, excluded.first_paid_at),
      past_due_since = case when excluded.subscription_status = 'past_due' and beauty_billing_accounts.subscription_status is distinct from 'past_due' then coalesce(p_event_created_at, now()) when excluded.subscription_status in ('active','trialing') then null else beauty_billing_accounts.past_due_since end,
      grace_ends_at = case when excluded.subscription_status = 'past_due' and beauty_billing_accounts.subscription_status is distinct from 'past_due' then coalesce(p_event_created_at, now()) + interval '7 days' when excluded.subscription_status in ('active','trialing') then null else beauty_billing_accounts.grace_ends_at end,
      last_stripe_event_created_at = excluded.last_stripe_event_created_at, updated_at = now();
  end if;

  if p_first_paid and p_event_type = 'invoice.paid' and p_plan_code = 'founder' then
    update public.beauty_founder_entitlements e set status = 'confirmed', stripe_subscription_id = p_stripe_subscription_id,
      confirmed_at = now(), expires_at = null, updated_at = now()
      from public.beauty_billing_checkout_sessions c
      where e.checkout_session_id = c.id and e.business_id = p_business_id and e.status = 'reserved'
        and c.id = p_internal_checkout_id and c.business_id = p_business_id and c.plan_code = 'founder'
        and c.stripe_customer_id = p_stripe_customer_id and c.stripe_subscription_id = p_stripe_subscription_id;
    if not found then raise exception 'Founder reservation correlation missing' using errcode = '23514'; end if;
  end if;
  return case when v_stale then 'processed_stale' else 'processed' end;
end; $$;

revoke all on function public.reserve_beauty_billing_checkout(uuid,uuid), public.bind_beauty_billing_checkout_session(uuid,text,text,timestamptz), public.release_beauty_founder_reservation(text), public.release_beauty_billing_checkout(uuid) from public, anon, authenticated;
revoke all on function public.apply_beauty_stripe_webhook(text,text,timestamptz,uuid,uuid,text,text,text,text,text,timestamptz,boolean,boolean,boolean) from public, anon, authenticated;
revoke all on function public.get_beauty_billing_access(uuid) from public, anon;
grant execute on function public.get_beauty_billing_access(uuid) to authenticated;

-- Edge Functions authenticate as service_role. Browser roles never receive table or private-RPC access.
grant select on table public.beauty_billing_test_subjects, public.beauty_billing_accounts,
  public.beauty_billing_checkout_sessions to service_role;
grant execute on function public.reserve_beauty_billing_checkout(uuid,uuid),
  public.bind_beauty_billing_checkout_session(uuid,text,text,timestamptz),
  public.release_beauty_billing_checkout(uuid),
  public.apply_beauty_stripe_webhook(text,text,timestamptz,uuid,uuid,text,text,text,text,text,timestamptz,boolean,boolean,boolean) to service_role;
