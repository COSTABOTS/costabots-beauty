-- Qualify table reads that otherwise collide with RETURNS TABLE output variables.
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
  perform pg_advisory_xact_lock(hashtextextended('beauty-founder-test-slots'::text, 0::bigint));
  update public.beauty_founder_entitlements as e set status = 'released', released_at = now(), updated_at = now()
    where e.status = 'reserved' and e.expires_at <= now();
  select c.id, c.plan_code, c.expires_at into v_checkout_id, v_plan, v_expiry
    from public.beauty_billing_checkout_sessions c
    where c.business_id = p_business_id and c.status in ('created', 'open') and c.expires_at > now()
    order by c.created_at desc limit 1 for update;
  if v_checkout_id is not null then
    select e.id into v_founder_id from public.beauty_founder_entitlements e
      where e.checkout_session_id = v_checkout_id and e.status = 'reserved';
    return query select v_checkout_id, v_plan, v_founder_id, v_expiry;
    return;
  end if;
  select e.id into v_founder_id from public.beauty_founder_entitlements e where e.business_id = p_business_id for update;
  if v_founder_id is not null and exists (select 1 from public.beauty_founder_entitlements e where e.id = v_founder_id and e.status = 'confirmed') then
    v_plan := 'standard';
  elsif (select count(*) from public.beauty_founder_entitlements e where e.status = 'confirmed' or (e.status = 'reserved' and e.expires_at > now())) < 100 then
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
