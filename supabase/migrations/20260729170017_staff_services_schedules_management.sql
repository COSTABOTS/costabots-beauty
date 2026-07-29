-- Owner/admin configuration for professionals, services and weekly schedules.
-- No auth user can be linked through these frontend-facing functions.

create or replace function public.create_beauty_staff_member(
  p_business_id uuid, p_display_name text, p_phone text, p_email text,
  p_color_key text, p_sort_order integer
) returns public.staff_members
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare v_row public.staff_members; v_email text := nullif(lower(btrim(p_email)), ''); v_phone text;
begin
  if auth.uid() is null or not public.has_business_role(p_business_id, array['owner','admin']) then
    raise exception 'Not allowed to manage Beauty staff' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_display_name,''))) not between 1 and 160 then raise exception 'Staff name is invalid' using errcode='22023'; end if;
  if coalesce(p_color_key,'') not in ('coral','sage','sand') then raise exception 'Staff color is invalid' using errcode='22023'; end if;
  if coalesce(p_sort_order,-1) not between 0 and 999 then raise exception 'Staff sort order is invalid' using errcode='22023'; end if;
  if v_email is not null and v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then raise exception 'Staff email is invalid' using errcode='22023'; end if;
  v_phone := case when nullif(btrim(p_phone),'') is null then null else public.normalize_beauty_customer_phone(p_phone) end;
  insert into public.staff_members(business_id,display_name,phone,email,color_key,sort_order,active)
  values(p_business_id,btrim(p_display_name),v_phone,v_email,p_color_key,p_sort_order,true)
  returning * into v_row;
  return v_row;
end $$;

create or replace function public.update_beauty_staff_member(
  p_business_id uuid, p_staff_member_id uuid, p_display_name text, p_phone text,
  p_email text, p_color_key text, p_sort_order integer, p_active boolean
) returns public.staff_members
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare v_row public.staff_members; v_email text := nullif(lower(btrim(p_email)), ''); v_phone text;
begin
  if auth.uid() is null or not public.has_business_role(p_business_id, array['owner','admin']) then raise exception 'Not allowed to manage Beauty staff' using errcode='42501'; end if;
  if length(btrim(coalesce(p_display_name,''))) not between 1 and 160 then raise exception 'Staff name is invalid' using errcode='22023'; end if;
  if coalesce(p_color_key,'') not in ('coral','sage','sand') then raise exception 'Staff color is invalid' using errcode='22023'; end if;
  if coalesce(p_sort_order,-1) not between 0 and 999 then raise exception 'Staff sort order is invalid' using errcode='22023'; end if;
  if v_email is not null and v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then raise exception 'Staff email is invalid' using errcode='22023'; end if;
  v_phone := case when nullif(btrim(p_phone),'') is null then null else public.normalize_beauty_customer_phone(p_phone) end;
  update public.staff_members set display_name=btrim(p_display_name),phone=v_phone,email=v_email,
    color_key=p_color_key,sort_order=p_sort_order,active=coalesce(p_active,active),updated_at=now()
  where id=p_staff_member_id and business_id=p_business_id returning * into v_row;
  if not found then raise exception 'Staff member not found in this Beauty business' using errcode='P0002'; end if;
  return v_row;
end $$;

create or replace function public.deactivate_beauty_staff_member(p_business_id uuid,p_staff_member_id uuid)
returns public.staff_members language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare v_row public.staff_members;
begin
  if auth.uid() is null or not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'Not allowed to manage Beauty staff' using errcode='42501'; end if;
  if exists(select 1 from public.appointments a where a.business_id=p_business_id and a.assigned_staff_member_id=p_staff_member_id and a.starts_at>=now() and a.status not in ('completed','cancelled','no_show')) then
    raise exception 'Staff member has future appointments' using errcode='23P01';
  end if;
  update public.staff_members set active=false,updated_at=now() where id=p_staff_member_id and business_id=p_business_id returning * into v_row;
  if not found then raise exception 'Staff member not found in this Beauty business' using errcode='P0002'; end if;
  return v_row;
end $$;

create or replace function public.create_beauty_service(
  p_business_id uuid,p_name text,p_description text,p_duration_minutes integer,
  p_buffer_before_minutes integer,p_buffer_after_minutes integer,p_price numeric,
  p_currency text,p_online_booking_enabled boolean,p_reactivation_days integer
) returns public.beauty_services language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare v_row public.beauty_services; v_currency text:=upper(btrim(p_currency));
begin
  if auth.uid() is null or not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'Not allowed to manage Beauty services' using errcode='42501'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 160 then raise exception 'Service name is invalid' using errcode='22023'; end if;
  if coalesce(p_duration_minutes,0)<=0 then raise exception 'Service duration is invalid' using errcode='22023'; end if;
  if coalesce(p_buffer_before_minutes,-1)<0 or coalesce(p_buffer_after_minutes,-1)<0 then raise exception 'Service buffer is invalid' using errcode='22023'; end if;
  if p_price is null or p_price<0 then raise exception 'Service price is invalid' using errcode='22023'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'Service currency is invalid' using errcode='22023'; end if;
  if p_reactivation_days is not null and p_reactivation_days<=0 then raise exception 'Service reactivation days are invalid' using errcode='22023'; end if;
  insert into public.beauty_services(business_id,name,description,duration_minutes,buffer_before_minutes,buffer_after_minutes,price,currency,online_booking_enabled,reactivation_days,active)
  values(p_business_id,btrim(p_name),nullif(btrim(p_description),''),p_duration_minutes,p_buffer_before_minutes,p_buffer_after_minutes,p_price,v_currency,coalesce(p_online_booking_enabled,false),p_reactivation_days,true)
  returning * into v_row; return v_row;
end $$;

create or replace function public.update_beauty_service(
  p_business_id uuid,p_service_id uuid,p_name text,p_description text,p_duration_minutes integer,
  p_buffer_before_minutes integer,p_buffer_after_minutes integer,p_price numeric,p_currency text,
  p_online_booking_enabled boolean,p_reactivation_days integer,p_active boolean
) returns public.beauty_services language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare v_row public.beauty_services; v_currency text:=upper(btrim(p_currency));
begin
  if auth.uid() is null or not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'Not allowed to manage Beauty services' using errcode='42501'; end if;
  if length(btrim(coalesce(p_name,''))) not between 1 and 160 or coalesce(p_duration_minutes,0)<=0 or coalesce(p_buffer_before_minutes,-1)<0 or coalesce(p_buffer_after_minutes,-1)<0 or p_price is null or p_price<0 or v_currency !~ '^[A-Z]{3}$' or (p_reactivation_days is not null and p_reactivation_days<=0) then
    raise exception 'Service values are invalid' using errcode='22023';
  end if;
  update public.beauty_services set name=btrim(p_name),description=nullif(btrim(p_description),''),
    duration_minutes=p_duration_minutes,buffer_before_minutes=p_buffer_before_minutes,
    buffer_after_minutes=p_buffer_after_minutes,price=p_price,currency=v_currency,
    online_booking_enabled=coalesce(p_online_booking_enabled,false),reactivation_days=p_reactivation_days,
    active=coalesce(p_active,active),updated_at=now()
  where id=p_service_id and business_id=p_business_id returning * into v_row;
  if not found then raise exception 'Service not found in this Beauty business' using errcode='P0002'; end if;
  return v_row;
end $$;

create or replace function public.deactivate_beauty_service(p_business_id uuid,p_service_id uuid)
returns public.beauty_services language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare v_row public.beauty_services;
begin
  if auth.uid() is null or not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'Not allowed to manage Beauty services' using errcode='42501'; end if;
  if exists(select 1 from public.appointment_services aps join public.appointments a on a.id=aps.appointment_id and a.business_id=aps.business_id where aps.business_id=p_business_id and aps.service_id=p_service_id and a.starts_at>=now() and a.status not in ('completed','cancelled','no_show')) then
    raise exception 'Service is used in future appointments' using errcode='23P01';
  end if;
  update public.beauty_services set active=false,updated_at=now() where id=p_service_id and business_id=p_business_id returning * into v_row;
  if not found then raise exception 'Service not found in this Beauty business' using errcode='P0002'; end if;
  return v_row;
end $$;

create or replace function public.set_beauty_staff_service(
  p_business_id uuid,p_staff_member_id uuid,p_service_id uuid,
  p_custom_duration_minutes integer,p_custom_price numeric,p_active boolean
) returns public.staff_services language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare v_row public.staff_services;
begin
  if auth.uid() is null or not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'Not allowed to manage Beauty assignments' using errcode='42501'; end if;
  if not exists(select 1 from public.staff_members where id=p_staff_member_id and business_id=p_business_id) or not exists(select 1 from public.beauty_services where id=p_service_id and business_id=p_business_id) then raise exception 'Staff or service is invalid' using errcode='22023'; end if;
  if p_custom_duration_minutes is not null and p_custom_duration_minutes<=0 then raise exception 'Custom duration is invalid' using errcode='22023'; end if;
  if p_custom_price is not null and p_custom_price<0 then raise exception 'Custom price is invalid' using errcode='22023'; end if;
  insert into public.staff_services(business_id,staff_member_id,service_id,custom_duration_minutes,custom_price,active)
  values(p_business_id,p_staff_member_id,p_service_id,p_custom_duration_minutes,p_custom_price,coalesce(p_active,true))
  on conflict(business_id,staff_member_id,service_id) do update set custom_duration_minutes=excluded.custom_duration_minutes,custom_price=excluded.custom_price,active=excluded.active
  returning * into v_row; return v_row;
end $$;

create or replace function public.replace_beauty_staff_weekly_schedule(
  p_business_id uuid,p_staff_member_id uuid,p_segments jsonb
) returns integer language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'Not allowed to manage Beauty schedules' using errcode='42501'; end if;
  if not exists(select 1 from public.staff_members where id=p_staff_member_id and business_id=p_business_id) then raise exception 'Staff member is invalid' using errcode='22023'; end if;
  if p_segments is null or jsonb_typeof(p_segments)<>'array' or jsonb_array_length(p_segments)>35 then raise exception 'Weekly schedule is invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(p_segments) as x(day_of_week integer,start_time text,end_time text) where x.day_of_week not between 1 and 7 or x.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or x.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or x.start_time::time>=x.end_time::time) then raise exception 'Schedule segment is invalid' using errcode='22023'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_segments) with ordinality as a(day_of_week integer,start_time text,end_time text,n bigint)
    join jsonb_to_recordset(p_segments) with ordinality as b(day_of_week integer,start_time text,end_time text,n bigint)
      on a.n<b.n and a.day_of_week=b.day_of_week and a.start_time::time<b.end_time::time and a.end_time::time>b.start_time::time
  ) then raise exception 'Schedule segments overlap' using errcode='23P01'; end if;
  update public.staff_schedules set active=false,updated_at=now() where business_id=p_business_id and staff_member_id=p_staff_member_id and active;
  insert into public.staff_schedules(business_id,staff_member_id,day_of_week,start_time,end_time,active)
  select p_business_id,p_staff_member_id,x.day_of_week,x.start_time::time,x.end_time::time,true
  from jsonb_to_recordset(p_segments) as x(day_of_week integer,start_time text,end_time text);
  get diagnostics v_count=row_count; return v_count;
end $$;

revoke all on function public.create_beauty_staff_member(uuid,text,text,text,text,integer) from public,anon;
revoke all on function public.update_beauty_staff_member(uuid,uuid,text,text,text,text,integer,boolean) from public,anon;
revoke all on function public.deactivate_beauty_staff_member(uuid,uuid) from public,anon;
revoke all on function public.create_beauty_service(uuid,text,text,integer,integer,integer,numeric,text,boolean,integer) from public,anon;
revoke all on function public.update_beauty_service(uuid,uuid,text,text,integer,integer,integer,numeric,text,boolean,integer,boolean) from public,anon;
revoke all on function public.deactivate_beauty_service(uuid,uuid) from public,anon;
revoke all on function public.set_beauty_staff_service(uuid,uuid,uuid,integer,numeric,boolean) from public,anon;
revoke all on function public.replace_beauty_staff_weekly_schedule(uuid,uuid,jsonb) from public,anon;
grant execute on function public.create_beauty_staff_member(uuid,text,text,text,text,integer) to authenticated;
grant execute on function public.update_beauty_staff_member(uuid,uuid,text,text,text,text,integer,boolean) to authenticated;
grant execute on function public.deactivate_beauty_staff_member(uuid,uuid) to authenticated;
grant execute on function public.create_beauty_service(uuid,text,text,integer,integer,integer,numeric,text,boolean,integer) to authenticated;
grant execute on function public.update_beauty_service(uuid,uuid,text,text,integer,integer,integer,numeric,text,boolean,integer,boolean) to authenticated;
grant execute on function public.deactivate_beauty_service(uuid,uuid) to authenticated;
grant execute on function public.set_beauty_staff_service(uuid,uuid,uuid,integer,numeric,boolean) to authenticated;
grant execute on function public.replace_beauty_staff_weekly_schedule(uuid,uuid,jsonb) to authenticated;
