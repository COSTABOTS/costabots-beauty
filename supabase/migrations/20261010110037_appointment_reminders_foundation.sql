-- Beauty appointment reminder foundation. This migration deliberately creates
-- no scheduler and never contacts WhatsApp; it only persists server-side work.

alter table public.customers
  add column if not exists reminder_consent_status text not null default 'unknown'
    check (reminder_consent_status in ('unknown', 'granted', 'denied')),
  add column if not exists reminder_consent_decided_at timestamptz;

-- Historical false has never meant an explicit refusal. True is the only
-- unambiguous historical consent value.
update public.customers
set reminder_consent_status = case when reminder_consent then 'granted' else 'unknown' end,
    reminder_consent_decided_at = case when reminder_consent then coalesce(consent_updated_at, updated_at, created_at) else null end;

create or replace function public.sync_beauty_customer_reminder_consent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.reminder_consent_status not in ('unknown', 'granted', 'denied') then
    raise exception 'REMINDER_CONSENT_STATUS_INVALID' using errcode = '22023';
  end if;

  -- Legacy manager RPCs still write the boolean. A newly inserted false is
  -- unknown; an explicit later false update is an informed denial.
  if tg_op = 'INSERT' and new.reminder_consent and new.reminder_consent_status = 'unknown' then
    new.reminder_consent_status := 'granted';
  elsif tg_op = 'UPDATE'
    and new.reminder_consent is distinct from old.reminder_consent
    and new.reminder_consent_status is not distinct from old.reminder_consent_status then
    new.reminder_consent_status := case when new.reminder_consent then 'granted' else 'denied' end;
  end if;

  new.reminder_consent := new.reminder_consent_status = 'granted';
  if tg_op = 'INSERT' or new.reminder_consent_status is distinct from old.reminder_consent_status then
    new.reminder_consent_decided_at := case
      when new.reminder_consent_status = 'unknown' then null
      else coalesce(new.reminder_consent_decided_at, now())
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists beauty_sync_customer_reminder_consent on public.customers;
create trigger beauty_sync_customer_reminder_consent
before insert or update of reminder_consent, reminder_consent_status on public.customers
for each row execute function public.sync_beauty_customer_reminder_consent();
revoke all on function public.sync_beauty_customer_reminder_consent() from public, anon, authenticated;

create table if not exists public.beauty_appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.beauty_businesses(id) on delete cascade,
  appointment_id uuid not null,
  conversation_id uuid references public.beauty_conversations(id) on delete set null,
  kind text not null check (kind = 'day_before'),
  due_at timestamptz not null,
  schedule_revision integer not null default 1 check (schedule_revision > 0),
  status text not null check (status in ('awaiting_consent', 'pending', 'processing', 'sent', 'skipped', 'cancelled', 'failed')),
  skip_reason text,
  last_error_code text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  locked_at timestamptz,
  lock_token uuid,
  sent_at timestamptz,
  cancelled_at timestamptz,
  last_attempt_at timestamptz,
  message_id uuid references public.beauty_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_appointment_reminders_appointment_business_fk
    foreign key (appointment_id, business_id)
    references public.appointments(id, business_id) on delete cascade,
  constraint beauty_appointment_reminders_appointment_kind_unique unique (appointment_id, kind),
  constraint beauty_appointment_reminders_lock_shape_check check (
    (status = 'processing' and locked_at is not null and lock_token is not null)
    or status <> 'processing'
  )
);

create index if not exists beauty_appointment_reminders_claim_idx
  on public.beauty_appointment_reminders (due_at, next_attempt_at)
  where status in ('pending', 'processing');
create index if not exists beauty_appointment_reminders_business_appointment_idx
  on public.beauty_appointment_reminders (business_id, appointment_id);

drop trigger if exists beauty_set_updated_at on public.beauty_appointment_reminders;
create trigger beauty_set_updated_at before update on public.beauty_appointment_reminders
for each row execute function public.beauty_set_updated_at();

alter table public.beauty_appointment_reminders enable row level security;
alter table public.beauty_appointment_reminders force row level security;
revoke all privileges on table public.beauty_appointment_reminders from public, anon, authenticated, service_role;
grant select, insert, update on table public.beauty_appointment_reminders to service_role;

create or replace function public.beauty_reminder_due_at(
  p_starts_at timestamptz,
  p_timezone text
) returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select (((p_starts_at at time zone p_timezone)::date - 1)
    + (p_starts_at at time zone p_timezone)::time) at time zone p_timezone;
$$;

create or replace function public.sync_beauty_appointment_reminder(
  p_business_id uuid,
  p_appointment_id uuid,
  p_conversation_id uuid default null,
  p_increment_revision boolean default false
) returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_appointment public.appointments;
  v_timezone text;
  v_consent text;
  v_due_at timestamptz;
  v_status text;
  v_skip_reason text := null;
  v_existing public.beauty_appointment_reminders;
  v_conversation_business_id uuid;
begin
  select * into v_appointment
  from public.appointments
  where id = p_appointment_id and business_id = p_business_id;
  if not found then raise exception 'REMINDER_APPOINTMENT_NOT_FOUND' using errcode = 'P0002'; end if;

  if p_conversation_id is not null then
    select business_id into v_conversation_business_id
    from public.beauty_conversations where id = p_conversation_id;
    if v_conversation_business_id is distinct from p_business_id then
      raise exception 'REMINDER_CONVERSATION_INVALID' using errcode = '22023';
    end if;
  end if;

  select timezone into v_timezone from public.beauty_businesses
  where id = p_business_id and active;
  if v_timezone is null then raise exception 'REMINDER_BUSINESS_INVALID' using errcode = '22023'; end if;
  select reminder_consent_status into v_consent from public.customers
  where id = v_appointment.customer_id and business_id = p_business_id;
  if v_consent is null then raise exception 'REMINDER_CUSTOMER_INVALID' using errcode = '22023'; end if;

  v_due_at := public.beauty_reminder_due_at(v_appointment.starts_at, v_timezone);
  if v_appointment.status = 'cancelled' then
    v_status := 'cancelled';
  elsif v_consent = 'denied' then
    -- Refusal is the decisive reason even if the appointment is also too near.
    v_status := 'skipped'; v_skip_reason := 'CONSENT_DENIED';
  elsif v_appointment.starts_at <= now() + interval '24 hours' then
    v_status := 'skipped'; v_skip_reason := 'TOO_LATE';
  elsif v_consent = 'granted' then
    v_status := 'pending';
  elsif v_consent = 'unknown' then
    v_status := 'awaiting_consent';
  else
    raise exception 'REMINDER_CONSENT_STATUS_INVALID' using errcode = '22023';
  end if;

  select * into v_existing from public.beauty_appointment_reminders
  where appointment_id = p_appointment_id and kind = 'day_before' for update;

  if not found then
    insert into public.beauty_appointment_reminders (
      business_id, appointment_id, conversation_id, kind, due_at, schedule_revision,
      status, skip_reason, next_attempt_at, cancelled_at
    ) values (
      p_business_id, p_appointment_id, p_conversation_id, 'day_before', v_due_at, 1,
      v_status, v_skip_reason,
      case when v_status = 'pending' then v_due_at else null end,
      case when v_status = 'cancelled' then now() else null end
    );
    return;
  end if;

  if p_increment_revision then
    update public.beauty_appointment_reminders set
      conversation_id = coalesce(p_conversation_id, conversation_id),
      due_at = v_due_at,
      schedule_revision = schedule_revision + 1,
      status = v_status,
      skip_reason = v_skip_reason,
      last_error_code = null,
      attempt_count = 0,
      next_attempt_at = case when v_status = 'pending' then v_due_at else null end,
      locked_at = null,
      lock_token = null,
      sent_at = null,
      cancelled_at = case when v_status = 'cancelled' then now() else null end,
      last_attempt_at = null,
      message_id = null
    where id = v_existing.id;
  end if;
end;
$$;

create or replace function public.cancel_beauty_appointment_reminders(
  p_business_id uuid,
  p_appointment_id uuid
) returns void
language sql
volatile
security definer
set search_path = pg_catalog, public
as $$
  update public.beauty_appointment_reminders
  set status = 'cancelled', cancelled_at = now(), next_attempt_at = null,
      locked_at = null, lock_token = null
  where business_id = p_business_id and appointment_id = p_appointment_id
    and status <> 'sent';
$$;

revoke all on function public.beauty_reminder_due_at(timestamptz, text) from public, anon, authenticated;
revoke all on function public.sync_beauty_appointment_reminder(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.cancel_beauty_appointment_reminders(uuid, uuid) from public, anon, authenticated;
grant execute on function public.sync_beauty_appointment_reminder(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.cancel_beauty_appointment_reminders(uuid, uuid) to service_role;

-- Booking confirmation remains the transactional source of the initial
-- reminder, including the originating conversation required for WhatsApp.
create or replace function public.confirm_beauty_booking_session(
  p_business_id uuid,
  p_conversation_id uuid,
  p_booking_session_id uuid,
  p_inbound_message_id uuid,
  p_expected_version integer
) returns table (
  outcome text, appointment_id uuid, starts_at timestamptz, ends_at timestamptz,
  service_name text, staff_display_name text, customer_id uuid, offered_times jsonb,
  session_version integer
)
language plpgsql volatile security definer set search_path = pg_catalog, public
as $$
declare
  v_session public.beauty_booking_sessions; v_existing public.appointments;
  v_conversation public.beauty_conversations; v_customer public.customers;
  v_customer_phone text; v_service_name text; v_currency char(3); v_duration integer;
  v_price numeric(12,2); v_ends_at timestamptz; v_staff_name text; v_timezone text;
  v_options jsonb := '[]'::jsonb; v_appointment public.appointments;
begin
  select * into v_session from public.beauty_booking_sessions s
  where s.id = p_booking_session_id and s.business_id = p_business_id and s.conversation_id = p_conversation_id for update;
  if not found then raise exception 'BOOKING_SESSION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_session.status = 'completed' and v_session.appointment_id is not null then
    select * into v_existing from public.appointments a where a.id = v_session.appointment_id and a.business_id = p_business_id;
    return query select 'confirmed', v_existing.id, v_existing.starts_at, v_existing.ends_at, bs.name, sm.display_name, v_existing.customer_id, '[]'::jsonb, v_session.version
    from public.beauty_services bs, public.staff_members sm where bs.id = v_session.service_id and sm.id = v_existing.assigned_staff_member_id;
    return;
  end if;
  if v_session.version <> p_expected_version then raise exception 'BOOKING_SESSION_VERSION_CONFLICT' using errcode = '40001'; end if;
  if v_session.status <> 'awaiting_confirmation' or v_session.service_id is null or v_session.staff_id is null
    or v_session.selected_date is null or v_session.selected_starts_at is null or v_session.expires_at <= now()
    or not public.beauty_booking_selection_valid(v_session.offered_times, v_session.selected_starts_at, v_session.staff_id) then
    raise exception 'BOOKING_SESSION_INVALID' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text || ':' || v_session.staff_id::text || ':' || v_session.selected_date::text, 0));
  select c.* into v_conversation from public.beauty_conversations c where c.id = p_conversation_id and c.business_id = p_business_id and c.active;
  if not found or v_conversation.remote_phone_normalized is null then raise exception 'BOOKING_CUSTOMER_PHONE_MISSING' using errcode = '22023'; end if;
  v_customer_phone := public.normalize_beauty_customer_phone(v_conversation.remote_phone_normalized);
  select b.timezone into v_timezone from public.beauty_businesses b where b.id = p_business_id and b.active;
  select s.name, s.currency, coalesce(ss.custom_duration_minutes, s.duration_minutes), coalesce(ss.custom_price, s.price), sm.display_name
  into v_service_name, v_currency, v_duration, v_price, v_staff_name
  from public.beauty_services s join public.staff_services ss on ss.business_id = s.business_id and ss.service_id = s.id and ss.staff_member_id = v_session.staff_id and ss.active
  join public.staff_members sm on sm.id = ss.staff_member_id and sm.business_id = s.business_id and sm.active
  where s.id = v_session.service_id and s.business_id = p_business_id and s.active and s.online_booking_enabled;
  if not found then raise exception 'BOOKING_SERVICE_INVALID' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('starts_at', q.starts_at, 'staff_id', q.staff_member_id, 'staff_display_name', q.staff_display_name, 'label', to_char(q.starts_at at time zone v_timezone, 'HH24:MI')) order by q.starts_at), '[]'::jsonb)
  into v_options from (select a.* from public.get_beauty_ai_availability(p_business_id, v_session.service_id, v_session.selected_date, null) a where a.available limit 5) q;
  if not exists (select 1 from public.get_beauty_ai_availability(p_business_id, v_session.service_id, v_session.selected_date, v_session.staff_id) a where a.available and a.starts_at = v_session.selected_starts_at) then
    update public.beauty_booking_sessions set status = 'choosing_time', offered_times = v_options, selected_starts_at = null, staff_id = null, last_processed_inbound_message_id = p_inbound_message_id, last_error_code = 'AVAILABILITY_CHANGED', version = version + 1 where id = v_session.id;
    return query select 'unavailable', null::uuid, null::timestamptz, null::timestamptz, v_service_name, null::text, null::uuid, v_options, v_session.version + 1; return;
  end if;
  insert into public.customers (business_id, first_name, phone, phone_normalized)
  values (p_business_id, left(coalesce(nullif(btrim(v_conversation.contact_name), ''), 'Cliente WhatsApp'), 120), v_customer_phone, v_customer_phone)
  on conflict (business_id, phone_normalized) where phone_normalized is not null do update set active = true returning * into v_customer;
  v_ends_at := v_session.selected_starts_at + make_interval(mins => v_duration);
  insert into public.appointments (business_id, customer_id, starts_at, ends_at, status, source, total_duration_minutes, total_price, currency, assigned_staff_member_id)
  values (p_business_id, v_customer.id, v_session.selected_starts_at, v_ends_at, 'confirmed', 'whatsapp_ai', v_duration, v_price, v_currency, v_session.staff_id) returning * into v_appointment;
  insert into public.appointment_services (business_id, appointment_id, service_id, staff_member_id, position, duration_minutes, price, starts_at, ends_at)
  values (p_business_id, v_appointment.id, v_session.service_id, v_session.staff_id, 1, v_duration, v_price, v_appointment.starts_at, v_appointment.ends_at);
  insert into public.appointment_events (business_id, appointment_id, event_type, previous_data, new_data, actor_user_id, source)
  values (p_business_id, v_appointment.id, 'created', null, jsonb_build_object('status', 'confirmed', 'starts_at', v_appointment.starts_at, 'ends_at', v_appointment.ends_at, 'assigned_staff_member_id', v_session.staff_id, 'service_count', 1), null, 'whatsapp_ai');
  perform public.sync_beauty_appointment_reminder(p_business_id, v_appointment.id, p_conversation_id, false);
  update public.beauty_booking_sessions set status = 'completed', appointment_id = v_appointment.id, confirmed_at = now(), last_processed_inbound_message_id = p_inbound_message_id, handoff_reason = null, last_error_code = null, version = version + 1 where id = v_session.id;
  update public.beauty_conversations set mode = 'ai', assigned_user_id = null, needs_attention = false, attention_reason = null where id = p_conversation_id and business_id = p_business_id;
  return query select 'confirmed', v_appointment.id, v_appointment.starts_at, v_appointment.ends_at, v_service_name, v_staff_name, v_customer.id, '[]'::jsonb, v_session.version + 1;
end;
$$;

revoke all on function public.confirm_beauty_booking_session(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.confirm_beauty_booking_session(uuid, uuid, uuid, uuid, integer)
  to service_role;

-- Reuse the existing manager RPC contracts and maintain reminder state in the
-- same transaction as a material schedule change or cancellation.
create or replace function public.update_beauty_appointment(
  p_business_id uuid,p_appointment_id uuid,p_starts_at timestamptz,
  p_assigned_staff_member_id uuid,p_service_ids uuid[],p_internal_notes text
) returns public.appointments
language plpgsql volatile security definer set search_path=pg_catalog,public
as $$
declare
  v_old public.appointments; v_new public.appointments; v_duration integer; v_price numeric(12,2); v_currency text; v_count integer; v_cursor timestamptz; v_item record; v_available boolean; v_timezone text; v_local_date date; v_staff_changed boolean; v_services_changed boolean; v_rescheduled boolean; v_notes_changed boolean;
begin
  if auth.uid() is null or not public.has_business_role(p_business_id,array['owner','admin']) then raise exception 'Not allowed to edit Beauty appointments' using errcode='42501'; end if;
  select * into v_old from public.appointments where id=p_appointment_id and business_id=p_business_id for update;
  if not found then raise exception 'Appointment not found in this Beauty business' using errcode='P0002'; end if;
  if v_old.status not in ('pending','confirmed') then raise exception 'Appointment is not editable in its current status' using errcode='22023'; end if;
  if p_service_ids is null or cardinality(p_service_ids)<1 or cardinality(p_service_ids)>12 then raise exception 'Invalid service list' using errcode='22023'; end if;
  if cardinality(p_service_ids) <> (select count(distinct value) from unnest(p_service_ids) value) then raise exception 'Duplicate services are not allowed' using errcode='22023'; end if;
  select timezone into v_timezone from public.beauty_businesses where id=p_business_id; v_local_date := (p_starts_at at time zone v_timezone)::date;
  select count(*),sum(coalesce(ss.custom_duration_minutes,s.duration_minutes))::integer,sum(coalesce(ss.custom_price,s.price))::numeric(12,2),min(s.currency) into v_count,v_duration,v_price,v_currency from unnest(p_service_ids) requested(service_id) join public.beauty_services s on s.id=requested.service_id and s.business_id=p_business_id and s.active join public.staff_services ss on ss.business_id=p_business_id and ss.staff_member_id=p_assigned_staff_member_id and ss.service_id=s.id and ss.active;
  if v_count<>cardinality(p_service_ids) then raise exception 'A service is invalid or not enabled for this professional' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text||':'||p_assigned_staff_member_id::text||':'||v_local_date::text,0));
  select true into v_available from public.get_multi_service_availability(p_business_id,p_service_ids,v_local_date,p_assigned_staff_member_id,p_appointment_id,15) where starts_at=p_starts_at limit 1;
  if not coalesce(v_available,false) then raise exception 'Requested start time is not available' using errcode='23P01'; end if;
  v_staff_changed:=v_old.assigned_staff_member_id<>p_assigned_staff_member_id; v_rescheduled:=v_old.starts_at<>p_starts_at; v_notes_changed:=coalesce(v_old.internal_notes,'')<>coalesce(btrim(p_internal_notes),'');
  select array_agg(service_id order by position) is distinct from p_service_ids into v_services_changed from public.appointment_services where appointment_id=p_appointment_id and business_id=p_business_id;
  update public.appointments set starts_at=p_starts_at,ends_at=p_starts_at+make_interval(mins=>v_duration),assigned_staff_member_id=p_assigned_staff_member_id,total_duration_minutes=v_duration,total_price=v_price,currency=v_currency,internal_notes=nullif(btrim(p_internal_notes),''),updated_at=now() where id=p_appointment_id and business_id=p_business_id returning * into v_new;
  delete from public.appointment_services where appointment_id=p_appointment_id and business_id=p_business_id;
  v_cursor:=p_starts_at;
  for v_item in select r.position,s.id service_id,coalesce(ss.custom_duration_minutes,s.duration_minutes) duration_minutes,coalesce(ss.custom_price,s.price)::numeric(12,2) price from unnest(p_service_ids) with ordinality r(service_id,position) join public.beauty_services s on s.id=r.service_id and s.business_id=p_business_id join public.staff_services ss on ss.business_id=p_business_id and ss.staff_member_id=p_assigned_staff_member_id and ss.service_id=s.id order by r.position loop
    insert into public.appointment_services(business_id,appointment_id,service_id,staff_member_id,position,duration_minutes,price,starts_at,ends_at) values(p_business_id,p_appointment_id,v_item.service_id,p_assigned_staff_member_id,v_item.position,v_item.duration_minutes,v_item.price,v_cursor,v_cursor+make_interval(mins=>v_item.duration_minutes)); v_cursor:=v_cursor+make_interval(mins=>v_item.duration_minutes);
  end loop;
  if v_rescheduled then insert into public.appointment_events(business_id,appointment_id,event_type,previous_data,new_data,actor_user_id,source) values(p_business_id,p_appointment_id,'rescheduled',jsonb_build_object('starts_at',v_old.starts_at),jsonb_build_object('starts_at',v_new.starts_at),auth.uid(),'manager'); end if;
  if v_staff_changed then insert into public.appointment_events(business_id,appointment_id,event_type,previous_data,new_data,actor_user_id,source) values(p_business_id,p_appointment_id,'staff_changed',jsonb_build_object('staff_id',v_old.assigned_staff_member_id),jsonb_build_object('staff_id',v_new.assigned_staff_member_id),auth.uid(),'manager'); end if;
  if v_services_changed then insert into public.appointment_events(business_id,appointment_id,event_type,previous_data,new_data,actor_user_id,source) values(p_business_id,p_appointment_id,'services_changed',null,jsonb_build_object('service_count',cardinality(p_service_ids)),auth.uid(),'manager'); end if;
  if v_notes_changed then insert into public.appointment_events(business_id,appointment_id,event_type,previous_data,new_data,actor_user_id,source) values(p_business_id,p_appointment_id,'notes_updated',null,jsonb_build_object('has_notes',nullif(btrim(p_internal_notes),'') is not null),auth.uid(),'manager'); end if;
  if v_rescheduled or v_staff_changed or v_services_changed then perform public.sync_beauty_appointment_reminder(p_business_id, p_appointment_id, null, true); end if;
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
  if not public.has_business_role(p_business_id,array['owner','admin'])
    and public.current_staff_member_id(p_business_id) is distinct from v_old.assigned_staff_member_id then
    raise exception 'Not allowed to cancel this appointment' using errcode='42501';
  end if;
  update public.appointments set status='cancelled',cancelled_at=now(),cancellation_reason=nullif(btrim(p_reason),''),updated_at=now() where id=p_appointment_id and business_id=p_business_id returning * into v_new;
  insert into public.appointment_events(business_id,appointment_id,event_type,previous_data,new_data,actor_user_id,source) values(p_business_id,p_appointment_id,'cancelled',jsonb_build_object('status',v_old.status),jsonb_build_object('status','cancelled','reason',nullif(btrim(p_reason),'')),auth.uid(),'manager');
  perform public.cancel_beauty_appointment_reminders(p_business_id, p_appointment_id);
  return v_new;
end $$;

-- Historical conversation identities are intentionally left untouched. Future
-- inbound values are normalized only by evolution-beauty-webhook, which never
-- infers a country code from an ambiguous local-looking number.
