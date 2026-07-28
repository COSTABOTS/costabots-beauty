-- Atomic appointment creation for authenticated Manager users.
-- p_services contains only ordered objects shaped as {"service_id": "<uuid>"}.
-- Prices, durations, currency and business ownership are always loaded again
-- from trusted tables.

create or replace function public.create_appointment_with_services(
  p_business_id uuid,
  p_customer_id uuid,
  p_starts_at timestamptz,
  p_assigned_staff_member_id uuid,
  p_status public.beauty_appointment_status default 'confirmed',
  p_source public.beauty_appointment_source default 'manager',
  p_customer_notes text default null,
  p_internal_notes text default null,
  p_services jsonb default '[]'::jsonb
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_service_count integer;
  v_matched_count integer;
  v_total_duration integer;
  v_total_price numeric(12,2);
  v_currency varchar(3);
  v_buffer_before integer;
  v_buffer_after integer;
  v_business_currency varchar(3);
  v_timezone text;
  v_local_date date;
  v_local_time time;
  v_available boolean;
  v_cursor timestamptz;
  v_item record;
  v_appointment public.appointments;
begin
  if auth.uid() is null
     or not public.is_business_member(p_business_id) then
    raise exception 'Not authorized for this Beauty business'
      using errcode = '42501';
  end if;

  if not (
    public.has_business_role(p_business_id, array['owner', 'admin'])
    or public.current_staff_member_id(p_business_id) = p_assigned_staff_member_id
  ) then
    raise exception 'Not allowed to create an appointment for this professional'
      using errcode = '42501';
  end if;

  if p_status not in ('pending', 'confirmed') then
    raise exception 'New appointments may only be pending or confirmed'
      using errcode = '22023';
  end if;

  if p_source not in ('manager', 'phone', 'walk_in') then
    raise exception 'This Manager RPC does not accept the requested source'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_services) <> 'array' then
    raise exception 'p_services must be a JSON array'
      using errcode = '22023';
  end if;

  v_service_count := jsonb_array_length(p_services);
  if v_service_count < 1 or v_service_count > 20 then
    raise exception 'An appointment must contain between 1 and 20 services'
      using errcode = '22023';
  end if;

  select bb.default_currency, bb.timezone
    into v_business_currency, v_timezone
  from public.beauty_businesses bb
  where bb.id = p_business_id
    and bb.active;

  if v_business_currency is null then
    raise exception 'Beauty business not found or inactive'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.customers c
    where c.id = p_customer_id
      and c.business_id = p_business_id
      and c.active
  ) then
    raise exception 'Customer not found in this Beauty business'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.staff_members sm
    where sm.id = p_assigned_staff_member_id
      and sm.business_id = p_business_id
      and sm.active
  ) then
    raise exception 'Professional not found in this Beauty business'
      using errcode = 'P0002';
  end if;

  -- Invalid UUID text fails the transaction before any write.
  with requested as (
    select (item.value ->> 'service_id')::uuid as service_id
    from jsonb_array_elements(p_services) item
  ),
  resolved as (
    select
      r.service_id,
      coalesce(ss.custom_duration_minutes, bs.duration_minutes) as duration_minutes,
      coalesce(ss.custom_price, bs.price) as price,
      bs.currency
    from requested r
    join public.beauty_services bs
      on bs.id = r.service_id
     and bs.business_id = p_business_id
     and bs.active
    join public.staff_services ss
      on ss.service_id = bs.id
     and ss.business_id = bs.business_id
     and ss.staff_member_id = p_assigned_staff_member_id
     and ss.active
  )
  select
    count(*),
    sum(duration_minutes)::integer,
    sum(price)::numeric(12,2),
    min(currency)
  into
    v_matched_count,
    v_total_duration,
    v_total_price,
    v_currency
  from resolved;

  if v_matched_count <> v_service_count then
    raise exception 'A service is invalid or not enabled for this professional'
      using errcode = '22023';
  end if;

  select bs.buffer_before_minutes
    into v_buffer_before
  from public.beauty_services bs
  where bs.id = (p_services -> 0 ->> 'service_id')::uuid
    and bs.business_id = p_business_id;

  select bs.buffer_after_minutes
    into v_buffer_after
  from public.beauty_services bs
  where bs.id = (
      p_services -> (v_service_count - 1) ->> 'service_id'
    )::uuid
    and bs.business_id = p_business_id;

  if v_currency <> v_business_currency or exists (
    select 1
    from jsonb_array_elements(p_services) item
    join public.beauty_services bs
      on bs.id = (item.value ->> 'service_id')::uuid
     and bs.business_id = p_business_id
    where bs.currency <> v_business_currency
  ) then
    raise exception 'All services must use the business default currency'
      using errcode = '22023';
  end if;

  v_local_date := (p_starts_at at time zone v_timezone)::date;
  v_local_time := (p_starts_at at time zone v_timezone)::time;

  -- Serializes booking attempts for one professional and local day.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_business_id::text || ':' ||
      p_assigned_staff_member_id::text || ':' ||
      v_local_date::text,
      0
    )
  );

  -- The availability RPC evaluates the first service buffers and the complete
  -- duration below is additionally checked against schedules and conflicts.
  with first_service as (
    select (p_services -> 0 ->> 'service_id')::uuid as service_id
  )
  select ga.available
    into v_available
  from first_service fs
  cross join lateral public.get_service_availability(
    p_business_id,
    fs.service_id,
    v_local_date,
    p_assigned_staff_member_id,
    v_local_time,
    v_local_time,
    15
  ) ga
  where ga.starts_at = p_starts_at
    and ga.staff_member_id = p_assigned_staff_member_id
  limit 1;

  if not coalesce(v_available, false) then
    raise exception 'Requested start time is not available'
      using errcode = '23P01';
  end if;

  -- A multi-service MVP appointment must fit in one weekly schedule segment.
  if not exists (
    select 1
    from public.staff_schedules sch
    where sch.business_id = p_business_id
      and sch.staff_member_id = p_assigned_staff_member_id
      and sch.active
      and sch.day_of_week = extract(isodow from v_local_date)::smallint
      and (sch.valid_from is null or sch.valid_from <= v_local_date)
      and (sch.valid_until is null or sch.valid_until >= v_local_date)
      and (
        v_local_time - make_interval(mins => v_buffer_before)
      )::time >= sch.start_time
      and (
        v_local_time
        + make_interval(mins => v_total_duration + v_buffer_after)
      )::time <= sch.end_time
  ) then
    raise exception 'All services must fit in one schedule segment'
      using errcode = '23P01';
  end if;

  -- Recheck existing appointments using the complete multi-service duration.
  if exists (
    select 1
    from public.appointments a
    where a.business_id = p_business_id
      and a.assigned_staff_member_id = p_assigned_staff_member_id
      and a.status <> 'cancelled'
      and (
        a.starts_at
        - make_interval(
            mins => coalesce((
              select bs_first.buffer_before_minutes
              from public.appointment_services aps_first
              join public.beauty_services bs_first
                on bs_first.id = aps_first.service_id
               and bs_first.business_id = aps_first.business_id
              where aps_first.appointment_id = a.id
                and aps_first.business_id = a.business_id
              order by aps_first.position
              limit 1
            ), 0)
          )
      )
        < p_starts_at
          + make_interval(mins => v_total_duration + v_buffer_after)
      and (
        a.ends_at
        + make_interval(
            mins => coalesce((
              select bs_last.buffer_after_minutes
              from public.appointment_services aps_last
              join public.beauty_services bs_last
                on bs_last.id = aps_last.service_id
               and bs_last.business_id = aps_last.business_id
              where aps_last.appointment_id = a.id
                and aps_last.business_id = a.business_id
              order by aps_last.position desc
              limit 1
            ), 0)
          )
      )
        > p_starts_at - make_interval(mins => v_buffer_before)
  ) or exists (
    select 1
    from public.time_blocks tb
    where tb.business_id = p_business_id
      and (tb.staff_member_id is null
           or tb.staff_member_id = p_assigned_staff_member_id)
      and tb.starts_at
        < p_starts_at
          + make_interval(mins => v_total_duration + v_buffer_after)
      and tb.ends_at
        > p_starts_at - make_interval(mins => v_buffer_before)
  ) then
    raise exception 'Appointment conflicts with an appointment or time block'
      using errcode = '23P01';
  end if;

  insert into public.appointments (
    business_id, customer_id, starts_at, ends_at, status, source,
    customer_notes, internal_notes, total_duration_minutes,
    total_price, currency, assigned_staff_member_id, created_by
  )
  values (
    p_business_id,
    p_customer_id,
    p_starts_at,
    p_starts_at + make_interval(mins => v_total_duration),
    p_status,
    p_source,
    nullif(btrim(p_customer_notes), ''),
    nullif(btrim(p_internal_notes), ''),
    v_total_duration,
    v_total_price,
    v_currency,
    p_assigned_staff_member_id,
    auth.uid()
  )
  returning * into v_appointment;

  v_cursor := p_starts_at;
  for v_item in
    select
      item.ordinality::integer as position,
      bs.id as service_id,
      coalesce(ss.custom_duration_minutes, bs.duration_minutes) as duration_minutes,
      coalesce(ss.custom_price, bs.price)::numeric(12,2) as price
    from jsonb_array_elements(p_services) with ordinality item(value, ordinality)
    join public.beauty_services bs
      on bs.id = (item.value ->> 'service_id')::uuid
     and bs.business_id = p_business_id
    join public.staff_services ss
      on ss.business_id = p_business_id
     and ss.service_id = bs.id
     and ss.staff_member_id = p_assigned_staff_member_id
     and ss.active
    order by item.ordinality
  loop
    insert into public.appointment_services (
      business_id, appointment_id, service_id, staff_member_id,
      position, duration_minutes, price, starts_at, ends_at
    )
    values (
      p_business_id,
      v_appointment.id,
      v_item.service_id,
      p_assigned_staff_member_id,
      v_item.position,
      v_item.duration_minutes,
      v_item.price,
      v_cursor,
      v_cursor + make_interval(mins => v_item.duration_minutes)
    );

    v_cursor := v_cursor + make_interval(mins => v_item.duration_minutes);
  end loop;

  insert into public.appointment_events (
    business_id, appointment_id, event_type,
    previous_data, new_data, actor_user_id, source
  )
  values (
    p_business_id,
    v_appointment.id,
    'created',
    null,
    jsonb_build_object(
      'status', v_appointment.status,
      'starts_at', v_appointment.starts_at,
      'ends_at', v_appointment.ends_at,
      'assigned_staff_member_id', v_appointment.assigned_staff_member_id,
      'service_count', v_service_count
    ),
    auth.uid(),
    p_source
  );

  return v_appointment;
end;
$$;

revoke all on function public.create_appointment_with_services(
  uuid, uuid, timestamptz, uuid,
  public.beauty_appointment_status,
  public.beauty_appointment_source,
  text, text, jsonb
) from public, anon;

grant execute on function public.create_appointment_with_services(
  uuid, uuid, timestamptz, uuid,
  public.beauty_appointment_status,
  public.beauty_appointment_source,
  text, text, jsonb
) to authenticated;
