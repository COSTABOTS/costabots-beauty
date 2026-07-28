-- One-time administrative bootstrap.
-- This function is deliberately NOT executable by anon or authenticated.
-- Run only from a trusted administrative SQL session after replacing the
-- placeholders documented in README.md, verify the result, then drop it.

create or replace function public.bootstrap_beauty_business_owner(
  p_existing_user_id uuid,
  p_business_name text,
  p_business_slug text,
  p_timezone text default 'Europe/Madrid',
  p_default_currency varchar(3) default 'EUR',
  p_default_language varchar(10) default 'es'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_business_id uuid;
begin
  if not exists (
    select 1 from auth.users au where au.id = p_existing_user_id
  ) then
    raise exception 'The requested auth.user does not exist'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names t where t.name = p_timezone
  ) then
    raise exception 'Invalid IANA timezone'
      using errcode = '22023';
  end if;

  if p_default_currency !~ '^[A-Z]{3}$' then
    raise exception 'Currency must be a three-letter uppercase ISO code'
      using errcode = '22023';
  end if;

  select bb.id
    into v_business_id
  from public.beauty_businesses bb
  where bb.slug = lower(btrim(p_business_slug));

  if v_business_id is null then
    insert into public.beauty_businesses (
      name, slug, timezone, default_currency, default_language
    )
    values (
      btrim(p_business_name),
      lower(btrim(p_business_slug)),
      p_timezone,
      p_default_currency,
      p_default_language
    )
    returning id into v_business_id;
  elsif exists (
    select 1
    from public.business_members bm
    where bm.business_id = v_business_id
      and bm.role = 'owner'
      and bm.user_id <> p_existing_user_id
      and bm.active
  ) then
    raise exception 'The slug already belongs to a business with another owner'
      using errcode = '23505';
  end if;

  insert into public.business_members (
    business_id, user_id, role, active
  )
  values (
    v_business_id, p_existing_user_id, 'owner', true
  )
  on conflict (business_id, user_id)
  do update set
    role = 'owner',
    active = true,
    updated_at = now();

  return v_business_id;
end;
$$;

revoke all on function public.bootstrap_beauty_business_owner(
  uuid, text, text, text, varchar, varchar
) from public, anon, authenticated;

comment on function public.bootstrap_beauty_business_owner(
  uuid, text, text, text, varchar, varchar
) is
  'Temporary one-time administrative bootstrap. Drop after the initial owner is verified.';

