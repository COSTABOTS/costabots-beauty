-- Transactional Agenda operations for authenticated Beauty managers.

create or replace function public.get_multi_service_availability(
  p_business_id uuid,
  p_service_ids uuid[],
  p_date date,
  p_staff_member_id uuid,
  p_exclude_appointment_id uuid default null,
  p_slot_interval_minutes integer default 15
) returns table (
  staff_member_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  service_duration_minutes integer,
  available boolean
)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_timezone text;
  v_duration integer;
  v_buffer_before integer;
  v_buffer_after integer;
  v_count integer;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'Not authorized for this Beauty business' using errcode='42501';
  end if;
  if p_service_ids is null or cardinality(p_service_ids) < 1
     or cardinality(p_service_ids) > 12
     or p_slot_interval_minutes not between 5 and 60 then
    raise exception 'Invalid service list or slot interval' using errcode='22023';
  end if;
  if cardinality(p_service_ids) <> (select count(distinct value) from unnest(p_service_ids) value) then
    raise exception 'Duplicate services are not allowed' using errcode='22023';
  end if;
  select b.timezone into v_timezone from public.beauty_businesses b where b.id=p_business_id;
  select count(*),sum(coalesce(ss.custom_duration_minutes,s.duration_minutes))::integer
    into v_count,v_duration
  from unnest(p_service_ids) with ordinality requested(service_id,position)
  join public.beauty_services s on s.id=requested.service_id and s.business_id=p_business_id and s.active
  join public.staff_services ss on ss.business_id=p_business_id and ss.staff_member_id=p_staff_member_id
    and ss.service_id=s.id and ss.active;
  if v_count <> cardinality(p_service_ids) or not exists(
    select 1 from public.staff_members sm where sm.id=p_staff_member_id and sm.business_id=p_business_id and sm.active
  ) then raise exception 'A service is invalid or not enabled for this professional' using errcode='22023'; end if;
  select s.buffer_before_minutes into v_buffer_before from public.beauty_services s where s.id=p_service_ids[1] and s.business_id=p_business_id;
  select s.buffer_after_minutes into v_buffer_after from public.beauty_services s where s.id=p_service_ids[cardinality(p_service_ids)] and s.business_id=p_business_id;

  return query
  with slots as (
    select gs as local_start, sch.end_time
    from public.staff_schedules sch
    cross join lateral generate_series(
      p_date + sch.start_time + make_interval(mins=>v_buffer_before),
      p_date + sch.end_time - make_interval(mins=>v_duration+v_buffer_after),
      make_interval(mins=>p_slot_interval_minutes)
    ) gs
    where sch.business_id=p_business_id and sch.staff_member_id=p_staff_member_id and sch.active
      and sch.day_of_week=extract(isodow from p_date)::smallint
      and (sch.valid_from is null or sch.valid_from<=p_date)
      and (sch.valid_until is null or sch.valid_until>=p_date)
  ), resolved as (
    select (local_start at time zone v_timezone) as start_at
    from slots
  )
  select p_staff_member_id,r.start_at,r.start_at+make_interval(mins=>v_duration),v_duration,true
  from resolved r
  where not exists (
    select 1 from public.appointments a
    where a.business_id=p_business_id and a.assigned_staff_member_id=p_staff_member_id
      and a.status<>'cancelled' and a.id is distinct from p_exclude_appointment_id
      and a.starts_at - make_interval(mins=>coalesce((
        select first_service.buffer_before_minutes
        from public.appointment_services first_link
        join public.beauty_services first_service on first_service.id=first_link.service_id
        where first_link.appointment_id=a.id and first_link.business_id=a.business_id
        order by first_link.position limit 1
      ),0)) < r.start_at+make_interval(mins=>v_duration+v_buffer_after)
      and a.ends_at + make_interval(mins=>coalesce((
        select last_service.buffer_after_minutes
        from public.appointment_services last_link
        join public.beauty_services last_service on last_service.id=last_link.service_id
        where last_link.appointment_id=a.id and last_link.business_id=a.business_id
        order by last_link.position desc limit 1
      ),0)) > r.start_at-make_interval(mins=>v_buffer_before)
  ) and not exists (
    select 1 from public.time_blocks tb where tb.business_id=p_business_id
      and (tb.staff_member_id is null or tb.staff_member_id=p_staff_member_id)
      and tb.starts_at < r.start_at+make_interval(mins=>v_duration+v_buffer_after)
      and tb.ends_at > r.start_at-make_interval(mins=>v_buffer_before)
  )
  order by r.start_at;
end $$;

create or replace function public.update_beauty_appointment(
  p_business_id uuid,p_appointment_id uuid,p_starts_at timestamptz,
  p_assigned_staff_member_id uuid,p_service_ids uuid[],p_internal_notes text
) returns public.appointments
language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare
  v_old public.appointments; v_new public.appointments; v_duration integer; v_price numeric(12,2);
  v_currency text; v_count integer; v_cursor timestamptz; v_item record; v_available boolean;
  v_timezone text; v_local_date date;
  v_staff_changed boolean; v_services_changed boolean; v_rescheduled boolean; v_notes_changed boolean;
begin
  if auth.uid() is null or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Not allowed to edit Beauty appointments' using errcode='42501';
  end if;
  select * into v_old from public.appointments where id=p_appointment_id and business_id=p_business_id for update;
  if not found then raise exception 'Appointment not found in this Beauty business' using errcode='P0002'; end if;
  if v_old.status not in ('pending','confirmed') then raise exception 'Appointment is not editable in its current status' using errcode='22023'; end if;
  if p_service_ids is null or cardinality(p_service_ids)<1 or cardinality(p_service_ids)>12 then raise exception 'Invalid service list' using errcode='22023'; end if;
  if cardinality(p_service_ids) <> (select count(distinct value) from unnest(p_service_ids) value) then raise exception 'Duplicate services are not allowed' using errcode='22023'; end if;
  select timezone into v_timezone from public.beauty_businesses where id=p_business_id;
  v_local_date := (p_starts_at at time zone v_timezone)::date;
  select count(*),sum(coalesce(ss.custom_duration_minutes,s.duration_minutes))::integer,
    sum(coalesce(ss.custom_price,s.price))::numeric(12,2),min(s.currency)
    into v_count,v_duration,v_price,v_currency
  from unnest(p_service_ids) requested(service_id)
  join public.beauty_services s on s.id=requested.service_id and s.business_id=p_business_id and s.active
  join public.staff_services ss on ss.business_id=p_business_id and ss.staff_member_id=p_assigned_staff_member_id and ss.service_id=s.id and ss.active;
  if v_count<>cardinality(p_service_ids) then raise exception 'A service is invalid or not enabled for this professional' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':'||p_assigned_staff_member_id::text||':'||v_local_date::text,0));
  select true into v_available from public.get_multi_service_availability(p_business_id,p_service_ids,v_local_date,p_assigned_staff_member_id,p_appointment_id,15)
  where starts_at=p_starts_at limit 1;
  if not coalesce(v_available,false) then raise exception 'Requested start time is not available' using errcode='23P01'; end if;
  v_staff_changed:=v_old.assigned_staff_member_id<>p_assigned_staff_member_id;
  v_rescheduled:=v_old.starts_at<>p_starts_at;
  v_notes_changed:=coalesce(v_old.internal_notes,'')<>coalesce(btrim(p_internal_notes),'');
  select array_agg(service_id order by position) is distinct from p_service_ids into v_services_changed
    from public.appointment_services where appointment_id=p_appointment_id and business_id=p_business_id;
  update public.appointments set starts_at=p_starts_at,ends_at=p_starts_at+make_interval(mins=>v_duration),
    assigned_staff_member_id=p_assigned_staff_member_id,total_duration_minutes=v_duration,total_price=v_price,
    currency=v_currency,internal_notes=nullif(btrim(p_internal_notes),''),updated_at=now()
    where id=p_appointment_id and business_id=p_business_id returning * into v_new;
  delete from public.appointment_services where appointment_id=p_appointment_id and business_id=p_business_id;
  v_cursor:=p_starts_at;
  for v_item in select r.position,s.id service_id,coalesce(ss.custom_duration_minutes,s.duration_minutes) duration_minutes,
      coalesce(ss.custom_price,s.price)::numeric(12,2) price
    from unnest(p_service_ids) with ordinality r(service_id,position)
    join public.beauty_services s on s.id=r.service_id and s.business_id=p_business_id
    join public.staff_services ss on ss.business_id=p_business_id and ss.staff_member_id=p_assigned_staff_member_id and ss.service_id=s.id
    order by r.position loop
    insert into public.appointment_services(business_id,appointment_id,service_id,staff_member_id,position,duration_minutes,price,starts_at,ends_at)
    values(p_business_id,p_appointment_id,v_item.service_id,p_assigned_staff_member_id,v_item.position,v_item.duration_minutes,v_item.price,v_cursor,v_cursor+make_interval(mins=>v_item.duration_minutes));
    v_cursor:=v_cursor+make_interval(mins=>v_item.duration_minutes);
  end loop;
  if v_rescheduled then insert into public.appointment_events(business_id,appointment_id,event_type,previous_data,new_data,actor_user_id,source) values(p_business_id,p_appointment_id,'rescheduled',jsonb_build_object('starts_at',v_old.starts_at),jsonb_build_object('starts_at',v_new.starts_at),auth.uid(),'manager'); end if;
  if v_staff_changed then insert into public.appointment_events(business_id,appointment_id,event_type,previous_data,new_data,actor_user_id,source) values(p_business_id,p_appointment_id,'staff_changed',jsonb_build_object('staff_id',v_old.assigned_staff_member_id),jsonb_build_object('staff_id',v_new.assigned_staff_member_id),auth.uid(),'manager'); end if;
  if v_services_changed then insert into public.appointment_events(business_id,appointment_id,event_type,previous_data,new_data,actor_user_id,source) values(p_business_id,p_appointment_id,'services_changed',null,jsonb_build_object('service_count',cardinality(p_service_ids)),auth.uid(),'manager'); end if;
  if v_notes_changed then insert into public.appointment_events(business_id,appointment_id,event_type,previous_data,new_data,actor_user_id,source) values(p_business_id,p_appointment_id,'notes_updated',null,jsonb_build_object('has_notes',nullif(btrim(p_internal_notes),'') is not null),auth.uid(),'manager'); end if;
  return v_new;
end $$;

create or replace function public.cancel_beauty_appointment(p_business_id uuid,p_appointment_id uuid,p_reason text)
returns public.appointments language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare v_old public.appointments; v_new public.appointments;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then raise exception 'Not authorized for this Beauty business' using errcode='42501'; end if;
  select * into v_old from public.appointments where id=p_appointment_id and business_id=p_business_id for update;
  if not found then raise exception 'Appointment not found in this Beauty business' using errcode='P0002'; end if;
  if v_old.status not in ('pending','confirmed') then raise exception 'Appointment is not cancellable in its current status' using errcode='22023'; end if;
  if not(public.has_business_role(p_business_id,array['owner','admin']) or public.current_staff_member_id(p_business_id)=v_old.assigned_staff_member_id) then raise exception 'Not allowed to cancel this appointment' using errcode='42501'; end if;
  update public.appointments set status='cancelled',cancelled_at=now(),cancellation_reason=nullif(btrim(p_reason),''),updated_at=now()
  where id=p_appointment_id and business_id=p_business_id returning * into v_new;
  insert into public.appointment_events(business_id,appointment_id,event_type,previous_data,new_data,actor_user_id,source)
  values(p_business_id,p_appointment_id,'cancelled',jsonb_build_object('status',v_old.status),jsonb_build_object('status','cancelled','reason',nullif(btrim(p_reason),'')),auth.uid(),'manager');
  return v_new;
end $$;

create or replace function public.update_beauty_time_block(p_business_id uuid,p_block_id uuid,p_staff_member_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_block_type public.beauty_time_block_type,p_reason text,p_notes text)
returns public.time_blocks language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare v_row public.time_blocks;
begin
 if auth.uid() is null or not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'Not allowed to edit Beauty blocks' using errcode='42501'; end if;
 if p_starts_at>=p_ends_at then raise exception 'Time block start must be earlier than end' using errcode='22023'; end if;
 if p_staff_member_id is not null and not exists(select 1 from public.staff_members where id=p_staff_member_id and business_id=p_business_id and active) then raise exception 'Professional not found in this Beauty business' using errcode='P0002'; end if;
 update public.time_blocks set staff_member_id=p_staff_member_id,starts_at=p_starts_at,ends_at=p_ends_at,block_type=p_block_type,reason=nullif(btrim(p_reason),''),notes=nullif(btrim(p_notes),''),updated_at=now()
 where id=p_block_id and business_id=p_business_id returning * into v_row;
 if not found then raise exception 'Time block not found in this Beauty business' using errcode='P0002'; end if; return v_row;
end $$;

create or replace function public.deactivate_beauty_time_block(p_business_id uuid,p_block_id uuid)
returns uuid language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare v_id uuid;
begin
 if auth.uid() is null or not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'Not allowed to remove Beauty blocks' using errcode='42501'; end if;
 delete from public.time_blocks where id=p_block_id and business_id=p_business_id returning id into v_id;
 if v_id is null then raise exception 'Time block not found in this Beauty business' using errcode='P0002'; end if; return v_id;
end $$;

revoke all on function public.get_multi_service_availability(uuid,uuid[],date,uuid,uuid,integer) from public,anon;
revoke all on function public.update_beauty_appointment(uuid,uuid,timestamptz,uuid,uuid[],text) from public,anon;
revoke all on function public.cancel_beauty_appointment(uuid,uuid,text) from public,anon;
revoke all on function public.update_beauty_time_block(uuid,uuid,uuid,timestamptz,timestamptz,public.beauty_time_block_type,text,text) from public,anon;
revoke all on function public.deactivate_beauty_time_block(uuid,uuid) from public,anon;
grant execute on function public.get_multi_service_availability(uuid,uuid[],date,uuid,uuid,integer) to authenticated;
grant execute on function public.update_beauty_appointment(uuid,uuid,timestamptz,uuid,uuid[],text) to authenticated;
grant execute on function public.cancel_beauty_appointment(uuid,uuid,text) to authenticated;
grant execute on function public.update_beauty_time_block(uuid,uuid,uuid,timestamptz,timestamptz,public.beauty_time_block_type,text,text) to authenticated;
grant execute on function public.deactivate_beauty_time_block(uuid,uuid) to authenticated;
