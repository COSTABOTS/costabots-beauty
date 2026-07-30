-- Transactional, tenant-safe import for reviewed service template rows.
-- Suggested prices and durations are client-editable; the database validates
-- every value and always applies the business currency.

create or replace function public.import_beauty_services(
  p_business_id uuid,
  p_services jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_currency varchar(3);
  v_item jsonb;
  v_name text;
  v_normalized_name text;
  v_duration integer;
  v_price numeric(12,2);
  v_duplicate_action text;
  v_existing_service_id uuid;
  v_service_id uuid;
  v_single_staff_id uuid;
  v_active_staff_count integer;
  v_created integer := 0;
  v_omitted integer := 0;
  v_replaced integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_PERMISSION';
  end if;

  select bb.default_currency
  into v_currency
  from public.beauty_businesses bb
  where bb.id = p_business_id
    and bb.active;

  if v_currency is null then
    raise exception using errcode = 'P0002', message = 'BUSINESS_NOT_FOUND';
  end if;

  if p_services is null
    or jsonb_typeof(p_services) <> 'array'
    or jsonb_array_length(p_services) < 1
    or jsonb_array_length(p_services) > 50
    or pg_column_size(p_services) > 65536 then
    raise exception using errcode = '22023', message = 'INVALID_SERVICE_IMPORT_SIZE';
  end if;

  -- Serialise imports per business so two requests cannot create equivalent
  -- active names between duplicate detection and insertion.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('beauty-service-import:' || p_business_id::text, 0)
  );

  select count(*), (array_agg(sm.id order by sm.id))[1]
  into v_active_staff_count, v_single_staff_id
  from public.staff_members sm
  where sm.business_id = p_business_id
    and sm.active;

  if v_active_staff_count <> 1 then
    v_single_staff_id := null;
  end if;

  for v_item in select value from jsonb_array_elements(p_services)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception using errcode = '22023', message = 'INVALID_SERVICE_ITEM';
    end if;

    v_name := btrim(coalesce(v_item ->> 'name', ''));
    v_duration := nullif(v_item ->> 'duration_minutes', '')::integer;
    v_price := nullif(v_item ->> 'price', '')::numeric(12,2);
    v_duplicate_action := lower(coalesce(v_item ->> 'duplicate_action', 'omit'));

    if length(v_name) < 1 or length(v_name) > 160 then
      raise exception using errcode = '22023', message = 'INVALID_SERVICE_NAME';
    end if;
    if v_duration is null or v_duration <> all(array[15,30,45,60,75,90,120,150,180]) then
      raise exception using errcode = '22023', message = 'INVALID_SERVICE_DURATION';
    end if;
    if v_price is null or v_price < 0 or v_price > 999999.99 then
      raise exception using errcode = '22023', message = 'INVALID_SERVICE_PRICE';
    end if;
    if v_duplicate_action not in ('omit', 'replace', 'new') then
      raise exception using errcode = '22023', message = 'INVALID_DUPLICATE_ACTION';
    end if;

    v_normalized_name := regexp_replace(
      translate(lower(v_name), 'áéíóúüñàèìòùäëïöüç', 'aeiouunaeiouaeiouc'),
      '\s+', '', 'g'
    );
    v_existing_service_id := null;

    select bs.id
    into v_existing_service_id
    from public.beauty_services bs
    where bs.business_id = p_business_id
      and bs.active
      and regexp_replace(
        translate(lower(btrim(bs.name)), 'áéíóúüñàèìòùäëïöüç', 'aeiouunaeiouaeiouc'),
        '\s+', '', 'g'
      ) = v_normalized_name
    order by bs.created_at
    limit 1;

    if v_existing_service_id is not null then
      if v_duplicate_action = 'omit' then
        v_omitted := v_omitted + 1;
        continue;
      elsif v_duplicate_action = 'new' then
        raise exception using errcode = '23505', message = 'DUPLICATE_SERVICE_RENAME_REQUIRED';
      end if;

      update public.beauty_services
      set duration_minutes = v_duration,
          price = v_price,
          currency = v_currency
      where id = v_existing_service_id
        and business_id = p_business_id;
      v_service_id := v_existing_service_id;
      v_replaced := v_replaced + 1;
    else
      insert into public.beauty_services (
        business_id, name, description, duration_minutes,
        buffer_before_minutes, buffer_after_minutes, price, currency,
        active, online_booking_enabled, reactivation_days
      ) values (
        p_business_id, v_name, null, v_duration,
        0, 0, v_price, v_currency,
        true, true, null
      )
      returning id into v_service_id;
      v_created := v_created + 1;
    end if;

    if v_single_staff_id is not null then
      insert into public.staff_services (
        business_id, staff_member_id, service_id,
        custom_duration_minutes, custom_price, active
      ) values (
        p_business_id, v_single_staff_id, v_service_id,
        null, null, true
      )
      on conflict (business_id, staff_member_id, service_id)
      do update set
        custom_duration_minutes = null,
        custom_price = null,
        active = true;
    end if;
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'omitted', v_omitted,
    'replaced', v_replaced,
    'assigned_staff_id', v_single_staff_id
  );
end;
$$;

revoke all on function public.import_beauty_services(uuid, jsonb) from public;
revoke all on function public.import_beauty_services(uuid, jsonb) from anon;
grant execute on function public.import_beauty_services(uuid, jsonb) to authenticated;

comment on function public.import_beauty_services(uuid, jsonb) is
  'Imports up to 50 reviewed Beauty services atomically, omits/replaces duplicates explicitly and auto-assigns only when exactly one active professional exists.';
