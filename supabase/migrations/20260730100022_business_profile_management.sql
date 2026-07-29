-- Restricted business-profile editing for the Beauty Manager.
-- The contract deliberately excludes slug, ownership, technical identifiers
-- and lifecycle fields.

create or replace function public.update_beauty_business_profile(
  p_business_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_address text,
  p_timezone text,
  p_currency text
) returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_phone text := nullif(btrim(p_phone), '');
  v_email text := nullif(lower(btrim(p_email)), '');
  v_address text := nullif(btrim(p_address), '');
  v_timezone text := btrim(coalesce(p_timezone, ''));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
begin
  if auth.uid() is null
    or not public.has_business_role(p_business_id, array['owner', 'admin'])
  then
    raise exception 'Not allowed to manage Beauty business profile'
      using errcode = '42501';
  end if;

  if length(v_name) not between 1 and 160 then
    raise exception 'Business name is required and must not exceed 160 characters'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names tz where tz.name = v_timezone
  ) then
    raise exception 'Business timezone is invalid'
      using errcode = '22023';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Business currency is invalid'
      using errcode = '22023';
  end if;

  if v_email is not null
    and v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$'
  then
    raise exception 'Business email is invalid'
      using errcode = '22023';
  end if;

  if v_phone is not null
    and (length(v_phone) not between 6 and 30 or v_phone !~ '^[+()0-9 .-]+$')
  then
    raise exception 'Business phone is invalid'
      using errcode = '22023';
  end if;

  if v_address is not null and length(v_address) > 300 then
    raise exception 'Business address is invalid'
      using errcode = '22023';
  end if;

  update public.beauty_businesses
  set
    name = v_name,
    phone = v_phone,
    email = v_email,
    address = v_address,
    timezone = v_timezone,
    default_currency = v_currency,
    updated_at = now()
  where id = p_business_id
    and active
  returning id into v_id;

  if v_id is null then
    raise exception 'Beauty business not found'
      using errcode = 'P0002';
  end if;

  return v_id;
end;
$$;

revoke all on function public.update_beauty_business_profile(
  uuid, text, text, text, text, text, text
) from public;
revoke all on function public.update_beauty_business_profile(
  uuid, text, text, text, text, text, text
) from anon;
grant execute on function public.update_beauty_business_profile(
  uuid, text, text, text, text, text, text
) to authenticated;

comment on function public.update_beauty_business_profile(
  uuid, text, text, text, text, text, text
) is
  'Owner/admin-only Beauty business profile update. Slug, ownership and technical fields are not part of the contract.';
