-- PostgreSQL does not allow WITH ORDINALITY together with the inline column
-- definition list used in migration 17. Replace only the affected RPC and
-- preserve the same authorization and transactional replacement contract.

create or replace function public.replace_beauty_staff_weekly_schedule(
  p_business_id uuid,
  p_staff_member_id uuid,
  p_segments jsonb
) returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null
    or not public.has_business_role(p_business_id, array['owner','admin'])
  then
    raise exception 'Not allowed to manage Beauty schedules'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.staff_members
    where id = p_staff_member_id
      and business_id = p_business_id
  ) then
    raise exception 'Staff member is invalid' using errcode = '22023';
  end if;

  if p_segments is null
    or jsonb_typeof(p_segments) <> 'array'
    or jsonb_array_length(p_segments) > 35
  then
    raise exception 'Weekly schedule is invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_segments)
      as segment(day_of_week integer, start_time text, end_time text)
    where segment.day_of_week not between 1 and 7
      or segment.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or segment.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or segment.start_time::time >= segment.end_time::time
  ) then
    raise exception 'Schedule segment is invalid' using errcode = '22023';
  end if;

  if exists (
    with segments as (
      select
        row_number() over () as segment_number,
        segment.day_of_week,
        segment.start_time::time as start_time,
        segment.end_time::time as end_time
      from jsonb_to_recordset(p_segments)
        as segment(day_of_week integer, start_time text, end_time text)
    )
    select 1
    from segments first_segment
    join segments second_segment
      on first_segment.segment_number < second_segment.segment_number
      and first_segment.day_of_week = second_segment.day_of_week
      and first_segment.start_time < second_segment.end_time
      and first_segment.end_time > second_segment.start_time
  ) then
    raise exception 'Schedule segments overlap' using errcode = '23P01';
  end if;

  update public.staff_schedules
  set active = false, updated_at = now()
  where business_id = p_business_id
    and staff_member_id = p_staff_member_id
    and active;

  insert into public.staff_schedules (
    business_id,
    staff_member_id,
    day_of_week,
    start_time,
    end_time,
    active
  )
  select
    p_business_id,
    p_staff_member_id,
    segment.day_of_week,
    segment.start_time::time,
    segment.end_time::time,
    true
  from jsonb_to_recordset(p_segments)
    as segment(day_of_week integer, start_time text, end_time text);

  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke all on function public.replace_beauty_staff_weekly_schedule(uuid,uuid,jsonb)
  from public, anon;
grant execute on function public.replace_beauty_staff_weekly_schedule(uuid,uuid,jsonb)
  to authenticated;
