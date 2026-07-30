-- Transactional, authenticated self-service provisioning for COSTABOTS Beauty.
-- The caller identity and initial owner role are never accepted as parameters.

alter table public.beauty_businesses
  add column if not exists business_type text not null default 'other';

alter table public.beauty_businesses
  drop constraint if exists beauty_businesses_business_type_check;
alter table public.beauty_businesses
  add constraint beauty_businesses_business_type_check
  check (business_type in ('nail_salon', 'hair_salon', 'beauty_center', 'other'));

create or replace function public.complete_beauty_signup(
  p_business_name text,
  p_owner_display_name text,
  p_business_type text,
  p_business_phone text,
  p_timezone text,
  p_currency text
) returns table (
  business_id uuid,
  membership_id uuid,
  staff_member_id uuid,
  created boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email_confirmed_at timestamptz;
  v_business_name text := btrim(coalesce(p_business_name, ''));
  v_owner_display_name text := btrim(coalesce(p_owner_display_name, ''));
  v_business_type text := lower(btrim(coalesce(p_business_type, '')));
  v_business_phone text;
  v_phone_digits text := pg_catalog.regexp_replace(
    coalesce(p_business_phone, ''),
    '[^0-9]',
    '',
    'g'
  );
  v_timezone text := btrim(coalesce(p_timezone, ''));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_business_id uuid;
  v_membership_id uuid;
  v_staff_member_id uuid;
  v_slug_base text;
  v_slug text;
begin
  if v_user_id is null then
    raise exception 'Authentication required'
      using errcode = '42501';
  end if;

  -- Serialize every provisioning attempt for the authenticated user. This
  -- protects double clicks, retries and concurrent browser sessions.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('beauty-signup:' || v_user_id::text, 0)
  );

  select u.email_confirmed_at
  into v_email_confirmed_at
  from auth.users u
  where u.id = v_user_id;

  if not found then
    raise exception 'Authenticated user not found'
      using errcode = 'P0002';
  end if;

  if v_email_confirmed_at is null then
    raise exception 'Email confirmation required'
      using errcode = '42501';
  end if;

  -- Any existing active membership wins. A retry must never create a second
  -- tenant, membership or professional.
  select bm.business_id, bm.id, sm.id
  into v_business_id, v_membership_id, v_staff_member_id
  from public.business_members bm
  join public.beauty_businesses bb
    on bb.id = bm.business_id
   and bb.active
  left join public.staff_members sm
    on sm.business_id = bm.business_id
   and sm.user_id = v_user_id
  where bm.user_id = v_user_id
    and bm.active
  order by bm.created_at, bm.id
  limit 1;

  if v_business_id is not null then
    return query
      select v_business_id, v_membership_id, v_staff_member_id, false;
    return;
  end if;

  if length(v_business_name) not between 1 and 160 then
    raise exception 'Business name is required and must not exceed 160 characters'
      using errcode = '22023';
  end if;

  if length(v_owner_display_name) not between 1 and 160 then
    raise exception 'Owner name is required and must not exceed 160 characters'
      using errcode = '22023';
  end if;

  if v_business_type not in ('nail_salon', 'hair_salon', 'beauty_center', 'other') then
    raise exception 'Business type is invalid'
      using errcode = '22023';
  end if;

  if length(v_phone_digits) not between 8 and 15 then
    raise exception 'Business phone is invalid'
      using errcode = '22023';
  end if;

  v_business_phone := case
    when btrim(p_business_phone) like '+%' then '+' || v_phone_digits
    when length(v_phone_digits) = 9 then '+34' || v_phone_digits
    else '+' || v_phone_digits
  end;

  if not exists (
    select 1
    from pg_catalog.pg_timezone_names tz
    where tz.name = v_timezone
  ) then
    raise exception 'Business timezone is invalid'
      using errcode = '22023';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Business currency is invalid'
      using errcode = '22023';
  end if;

  v_business_id := gen_random_uuid();
  v_slug_base := pg_catalog.regexp_replace(
    pg_catalog.translate(
      lower(v_business_name),
      'áéíóúüñç',
      'aeiouunc'
    ),
    '[^a-z0-9]+',
    '-',
    'g'
  );
  v_slug_base := pg_catalog.btrim(v_slug_base, '-');
  if v_slug_base = '' then
    v_slug_base := 'beauty';
  end if;
  v_slug := left(v_slug_base, 130)
    || '-'
    || left(pg_catalog.replace(v_business_id::text, '-', ''), 12);

  insert into public.beauty_businesses (
    id,
    name,
    slug,
    timezone,
    phone,
    default_currency,
    default_language,
    business_type,
    active
  ) values (
    v_business_id,
    v_business_name,
    v_slug,
    v_timezone,
    v_business_phone,
    v_currency,
    'es',
    v_business_type,
    true
  );

  insert into public.business_members (
    business_id,
    user_id,
    role,
    active
  ) values (
    v_business_id,
    v_user_id,
    'owner',
    true
  )
  returning id into v_membership_id;

  insert into public.staff_members (
    business_id,
    user_id,
    display_name,
    phone,
    color_key,
    active,
    sort_order
  ) values (
    v_business_id,
    v_user_id,
    v_owner_display_name,
    v_business_phone,
    'coral',
    true,
    0
  )
  returning id into v_staff_member_id;

  return query
    select v_business_id, v_membership_id, v_staff_member_id, true;
end;
$$;

revoke all on function public.complete_beauty_signup(
  text, text, text, text, text, text
) from public;
revoke all on function public.complete_beauty_signup(
  text, text, text, text, text, text
) from anon;
grant execute on function public.complete_beauty_signup(
  text, text, text, text, text, text
) to authenticated;

comment on function public.complete_beauty_signup(
  text, text, text, text, text, text
) is
  'Email-confirmed, authenticated and idempotent Beauty business provisioning. Identity and owner role derive exclusively from auth.uid().';
