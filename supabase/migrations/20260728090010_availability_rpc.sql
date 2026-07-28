-- Authenticated Manager availability. This RPC is not granted to anon.
-- Returned starts_at/ends_at represent service time; buffers are used only
-- for occupancy checks.

create or replace function public.get_service_availability(
  p_business_id uuid,
  p_service_id uuid,
  p_date date,
  p_staff_member_id uuid default null,
  p_time_from time default null,
  p_time_to time default null,
  p_slot_interval_minutes integer default 15
)
returns table (
  staff_member_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  service_duration_minutes integer,
  available boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_timezone text;
begin
  if auth.uid() is null
     or not public.is_business_member(p_business_id) then
    raise exception 'Not authorized for this Beauty business'
      using errcode = '42501';
  end if;

  if p_slot_interval_minutes < 5 or p_slot_interval_minutes > 120 then
    raise exception 'Slot interval must be between 5 and 120 minutes'
      using errcode = '22023';
  end if;

  if p_time_from is not null
     and p_time_to is not null
     and p_time_from > p_time_to then
    raise exception 'p_time_from must not be later than p_time_to'
      using errcode = '22023';
  end if;

  select bb.timezone
    into v_timezone
  from public.beauty_businesses bb
  where bb.id = p_business_id
    and bb.active;

  if v_timezone is null then
    raise exception 'Beauty business not found or inactive'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_timezone_names t
    where t.name = v_timezone
  ) then
    raise exception 'Beauty business has an invalid timezone'
      using errcode = '22023';
  end if;

  return query
  with eligible as (
    select
      sm.id as staff_member_id,
      coalesce(ss.custom_duration_minutes, bs.duration_minutes) as duration_minutes,
      bs.buffer_before_minutes,
      bs.buffer_after_minutes
    from public.staff_members sm
    join public.staff_services ss
      on ss.business_id = sm.business_id
     and ss.staff_member_id = sm.id
     and ss.service_id = p_service_id
     and ss.active
    join public.beauty_services bs
      on bs.business_id = ss.business_id
     and bs.id = ss.service_id
     and bs.active
    where sm.business_id = p_business_id
      and sm.active
      and (p_staff_member_id is null or sm.id = p_staff_member_id)
  ),
  schedule_bounds as (
    select
      e.*,
      (
        p_date + sch.start_time
        + make_interval(mins => e.buffer_before_minutes)
      ) at time zone v_timezone as first_service_start,
      (
        p_date + sch.end_time
        - make_interval(
            mins => e.duration_minutes + e.buffer_after_minutes
          )
      ) at time zone v_timezone as last_service_start
    from eligible e
    join public.staff_schedules sch
      on sch.business_id = p_business_id
     and sch.staff_member_id = e.staff_member_id
     and sch.active
     and sch.day_of_week = extract(isodow from p_date)::smallint
     and (sch.valid_from is null or sch.valid_from <= p_date)
     and (sch.valid_until is null or sch.valid_until >= p_date)
  ),
  candidates as (
    select
      sb.staff_member_id,
      slot_start as service_starts_at,
      slot_start + make_interval(mins => sb.duration_minutes) as service_ends_at,
      slot_start - make_interval(mins => sb.buffer_before_minutes) as occupied_starts_at,
      slot_start
        + make_interval(
            mins => sb.duration_minutes + sb.buffer_after_minutes
          ) as occupied_ends_at,
      sb.duration_minutes
    from schedule_bounds sb
    cross join lateral generate_series(
      sb.first_service_start,
      sb.last_service_start,
      make_interval(mins => p_slot_interval_minutes)
    ) slot_start
    where sb.first_service_start <= sb.last_service_start
      and (
        p_time_from is null
        or (slot_start at time zone v_timezone)::time >= p_time_from
      )
      and (
        p_time_to is null
        or (slot_start at time zone v_timezone)::time <= p_time_to
      )
  )
  select
    c.staff_member_id,
    c.service_starts_at,
    c.service_ends_at,
    c.duration_minutes,
    not exists (
      select 1
      from public.time_blocks tb
      where tb.business_id = p_business_id
        and (tb.staff_member_id is null or tb.staff_member_id = c.staff_member_id)
        and tb.starts_at < c.occupied_ends_at
        and tb.ends_at > c.occupied_starts_at
    )
    and not exists (
      select 1
      from public.appointments a
      where a.business_id = p_business_id
        and a.assigned_staff_member_id = c.staff_member_id
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
        ) < c.occupied_ends_at
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
        ) > c.occupied_starts_at
    ) as available
  from candidates c
  order by c.service_starts_at, c.staff_member_id;
end;
$$;

revoke all on function public.get_service_availability(
  uuid, uuid, date, uuid, time, time, integer
) from public, anon;

grant execute on function public.get_service_availability(
  uuid, uuid, date, uuid, time, time, integer
) to authenticated;

