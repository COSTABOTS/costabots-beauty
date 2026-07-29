-- Narrow customer-management RPCs for authenticated COSTABOTS Beauty managers.
-- The frontend never supplies editable tenant fields and never updates customers directly.

create or replace function public.normalize_beauty_customer_phone(p_phone text)
returns text
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_input text := btrim(coalesce(p_phone, ''));
  v_digits text;
  v_normalized text;
begin
  if v_input = '' then
    raise exception 'Customer phone is required'
      using errcode = '22023';
  end if;

  v_digits := regexp_replace(v_input, '[^0-9]', '', 'g');

  if left(v_input, 1) = '+' then
    v_normalized := '+' || v_digits;
  elsif left(v_digits, 2) = '00' then
    v_normalized := '+' || substr(v_digits, 3);
  elsif length(v_digits) = 9 then
    -- Beauty launches in Spain; local nine-digit numbers use the Spanish prefix.
    v_normalized := '+34' || v_digits;
  elsif length(v_digits) between 10 and 15 then
    v_normalized := '+' || v_digits;
  else
    raise exception 'Customer phone is invalid'
      using errcode = '22023';
  end if;

  if v_normalized !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Customer phone is invalid'
      using errcode = '22023';
  end if;

  return v_normalized;
end;
$$;

revoke all on function public.normalize_beauty_customer_phone(text)
  from public, anon, authenticated;

create or replace function public.create_beauty_customer(
  p_business_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_preferred_staff_member_id uuid,
  p_notes text,
  p_reminder_consent boolean,
  p_marketing_consent boolean
)
returns public.customers
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_customer public.customers;
  v_phone text;
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Not allowed to manage customers in this Beauty business'
      using errcode = '42501';
  end if;

  if length(btrim(coalesce(p_first_name, ''))) not between 1 and 120 then
    raise exception 'Customer first name is invalid'
      using errcode = '22023';
  end if;

  if v_email is not null
     and v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'Customer email is invalid'
      using errcode = '22023';
  end if;

  if p_preferred_staff_member_id is not null and not exists (
    select 1
    from public.staff_members sm
    where sm.id = p_preferred_staff_member_id
      and sm.business_id = p_business_id
      and sm.active
  ) then
    raise exception 'Preferred professional is invalid'
      using errcode = '22023';
  end if;

  v_phone := public.normalize_beauty_customer_phone(p_phone);

  if exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and c.phone_normalized = v_phone
  ) then
    raise exception 'Customer phone already exists'
      using errcode = '23505';
  end if;

  insert into public.customers (
    business_id, first_name, last_name, phone, phone_normalized, email,
    preferred_staff_member_id, notes, reminder_consent, marketing_consent,
    consent_updated_at, active
  )
  values (
    p_business_id,
    btrim(p_first_name),
    nullif(btrim(p_last_name), ''),
    v_phone,
    v_phone,
    v_email,
    p_preferred_staff_member_id,
    nullif(btrim(p_notes), ''),
    coalesce(p_reminder_consent, false),
    coalesce(p_marketing_consent, false),
    case
      when coalesce(p_reminder_consent, false)
        or coalesce(p_marketing_consent, false)
      then now()
      else null
    end,
    true
  )
  returning * into v_customer;

  return v_customer;
end;
$$;

revoke all on function public.create_beauty_customer(
  uuid, text, text, text, text, uuid, text, boolean, boolean
) from public, anon;
grant execute on function public.create_beauty_customer(
  uuid, text, text, text, text, uuid, text, boolean, boolean
) to authenticated;

create or replace function public.update_beauty_customer(
  p_business_id uuid,
  p_customer_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_preferred_staff_member_id uuid,
  p_notes text,
  p_reminder_consent boolean,
  p_marketing_consent boolean,
  p_active boolean
)
returns public.customers
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_customer public.customers;
  v_phone text;
  v_email text := nullif(lower(btrim(p_email)), '');
  v_reminder_consent boolean := coalesce(p_reminder_consent, false);
  v_marketing_consent boolean := coalesce(p_marketing_consent, false);
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Not allowed to manage customers in this Beauty business'
      using errcode = '42501';
  end if;

  select c.*
    into v_customer
  from public.customers c
  where c.id = p_customer_id
    and c.business_id = p_business_id
  for update;

  if not found then
    raise exception 'Customer not found in this Beauty business'
      using errcode = 'P0002';
  end if;

  if length(btrim(coalesce(p_first_name, ''))) not between 1 and 120 then
    raise exception 'Customer first name is invalid'
      using errcode = '22023';
  end if;

  if v_email is not null
     and v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'Customer email is invalid'
      using errcode = '22023';
  end if;

  if p_preferred_staff_member_id is not null and not exists (
    select 1
    from public.staff_members sm
    where sm.id = p_preferred_staff_member_id
      and sm.business_id = p_business_id
      and sm.active
  ) then
    raise exception 'Preferred professional is invalid'
      using errcode = '22023';
  end if;

  v_phone := public.normalize_beauty_customer_phone(p_phone);

  if exists (
    select 1
    from public.customers c
    where c.business_id = p_business_id
      and c.phone_normalized = v_phone
      and c.id <> p_customer_id
  ) then
    raise exception 'Customer phone already exists'
      using errcode = '23505';
  end if;

  update public.customers c
  set first_name = btrim(p_first_name),
      last_name = nullif(btrim(p_last_name), ''),
      phone = v_phone,
      phone_normalized = v_phone,
      email = v_email,
      preferred_staff_member_id = p_preferred_staff_member_id,
      notes = nullif(btrim(p_notes), ''),
      reminder_consent = v_reminder_consent,
      marketing_consent = v_marketing_consent,
      consent_updated_at = case
        when c.reminder_consent is distinct from v_reminder_consent
          or c.marketing_consent is distinct from v_marketing_consent
        then now()
        else c.consent_updated_at
      end,
      active = coalesce(p_active, c.active),
      updated_at = now()
  where c.id = p_customer_id
    and c.business_id = p_business_id
  returning c.* into v_customer;

  return v_customer;
end;
$$;

revoke all on function public.update_beauty_customer(
  uuid, uuid, text, text, text, text, uuid, text, boolean, boolean, boolean
) from public, anon;
grant execute on function public.update_beauty_customer(
  uuid, uuid, text, text, text, text, uuid, text, boolean, boolean, boolean
) to authenticated;

create or replace function public.deactivate_beauty_customer(
  p_business_id uuid,
  p_customer_id uuid
)
returns public.customers
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_customer public.customers;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Not allowed to manage customers in this Beauty business'
      using errcode = '42501';
  end if;

  update public.customers c
  set active = false,
      updated_at = now()
  where c.id = p_customer_id
    and c.business_id = p_business_id
  returning c.* into v_customer;

  if not found then
    raise exception 'Customer not found in this Beauty business'
      using errcode = 'P0002';
  end if;

  return v_customer;
end;
$$;

revoke all on function public.deactivate_beauty_customer(uuid, uuid)
  from public, anon;
grant execute on function public.deactivate_beauty_customer(uuid, uuid)
  to authenticated;
