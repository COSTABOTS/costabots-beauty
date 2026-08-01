alter table public.beauty_booking_sessions
  add column if not exists appointment_id uuid references public.appointments(id) on delete restrict,
  add column if not exists confirmed_at timestamptz;

create unique index if not exists beauty_booking_sessions_appointment_uidx
  on public.beauty_booking_sessions (appointment_id)
  where appointment_id is not null;

alter table public.beauty_booking_sessions
  drop constraint if exists beauty_booking_session_completed_appointment_check;
alter table public.beauty_booking_sessions
  add constraint beauty_booking_session_completed_appointment_check
  check (
    (status = 'completed' and appointment_id is not null and confirmed_at is not null)
    or status <> 'completed'
  ) not valid;

create or replace function public.confirm_beauty_booking_session(
  p_business_id uuid,
  p_conversation_id uuid,
  p_booking_session_id uuid,
  p_inbound_message_id uuid,
  p_expected_version integer
) returns table (
  outcome text,
  appointment_id uuid,
  starts_at timestamptz,
  ends_at timestamptz,
  service_name text,
  staff_display_name text,
  customer_id uuid,
  offered_times jsonb,
  session_version integer
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.beauty_booking_sessions;
  v_existing public.appointments;
  v_conversation public.beauty_conversations;
  v_customer public.customers;
  v_service_name text;
  v_currency char(3);
  v_duration integer;
  v_price numeric(12,2);
  v_ends_at timestamptz;
  v_staff_name text;
  v_timezone text;
  v_options jsonb := '[]'::jsonb;
  v_appointment public.appointments;
begin
  select * into v_session
  from public.beauty_booking_sessions s
  where s.id = p_booking_session_id
    and s.business_id = p_business_id
    and s.conversation_id = p_conversation_id
  for update;
  if not found then raise exception 'BOOKING_SESSION_NOT_FOUND' using errcode = 'P0002'; end if;

  if v_session.status = 'completed' and v_session.appointment_id is not null then
    select * into v_existing from public.appointments a
    where a.id = v_session.appointment_id and a.business_id = p_business_id;
    return query select 'confirmed', v_existing.id, v_existing.starts_at, v_existing.ends_at,
      bs.name, sm.display_name, v_existing.customer_id, '[]'::jsonb, v_session.version
    from public.beauty_services bs, public.staff_members sm
    where bs.id = v_session.service_id and sm.id = v_existing.assigned_staff_member_id;
    return;
  end if;

  if v_session.version <> p_expected_version then
    raise exception 'BOOKING_SESSION_VERSION_CONFLICT' using errcode = '40001';
  end if;
  if v_session.status <> 'awaiting_confirmation'
     or v_session.service_id is null or v_session.staff_id is null
     or v_session.selected_date is null or v_session.selected_starts_at is null
     or v_session.expires_at <= now()
     or not public.beauty_booking_selection_valid(
       v_session.offered_times, v_session.selected_starts_at, v_session.staff_id
     ) then
    raise exception 'BOOKING_SESSION_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_business_id::text || ':' || v_session.staff_id::text || ':' || v_session.selected_date::text, 0
  ));

  select c.* into v_conversation from public.beauty_conversations c
  where c.id = p_conversation_id and c.business_id = p_business_id and c.active;
  if not found or v_conversation.remote_phone_normalized is null then
    raise exception 'BOOKING_CUSTOMER_PHONE_MISSING' using errcode = '22023';
  end if;

  select b.timezone into v_timezone from public.beauty_businesses b
  where b.id = p_business_id and b.active;
  select s.name, s.currency, coalesce(ss.custom_duration_minutes, s.duration_minutes),
    coalesce(ss.custom_price, s.price), sm.display_name
  into v_service_name, v_currency, v_duration, v_price, v_staff_name
  from public.beauty_services s
  join public.staff_services ss on ss.business_id = s.business_id
    and ss.service_id = s.id and ss.staff_member_id = v_session.staff_id and ss.active
  join public.staff_members sm on sm.id = ss.staff_member_id
    and sm.business_id = s.business_id and sm.active
  where s.id = v_session.service_id and s.business_id = p_business_id
    and s.active and s.online_booking_enabled;
  if not found then raise exception 'BOOKING_SERVICE_INVALID' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'starts_at', q.starts_at,
    'staff_id', q.staff_member_id,
    'staff_display_name', q.staff_display_name,
    'label', to_char(q.starts_at at time zone v_timezone, 'HH24:MI')
  ) order by q.starts_at), '[]'::jsonb)
  into v_options
  from (
    select a.* from public.get_beauty_ai_availability(
      p_business_id, v_session.service_id, v_session.selected_date, null
    ) a where a.available limit 5
  ) q;

  if not exists (
    select 1 from public.get_beauty_ai_availability(
      p_business_id, v_session.service_id, v_session.selected_date, v_session.staff_id
    ) a where a.available and a.starts_at = v_session.selected_starts_at
  ) then
    update public.beauty_booking_sessions set
      status = 'choosing_time', offered_times = v_options,
      selected_starts_at = null, staff_id = null,
      last_processed_inbound_message_id = p_inbound_message_id,
      last_error_code = 'AVAILABILITY_CHANGED', version = version + 1
    where id = v_session.id;
    return query select 'unavailable', null::uuid, null::timestamptz, null::timestamptz,
      v_service_name, null::text, null::uuid, v_options, v_session.version + 1;
    return;
  end if;

  insert into public.customers (business_id, first_name, phone, phone_normalized)
  values (
    p_business_id,
    left(coalesce(nullif(btrim(v_conversation.contact_name), ''), 'Cliente WhatsApp'), 120),
    v_conversation.remote_phone_normalized,
    v_conversation.remote_phone_normalized
  )
  on conflict (business_id, phone_normalized) where phone_normalized is not null
  do update set active = true
  returning * into v_customer;

  v_ends_at := v_session.selected_starts_at + make_interval(mins => v_duration);
  insert into public.appointments (
    business_id, customer_id, starts_at, ends_at, status, source,
    total_duration_minutes, total_price, currency, assigned_staff_member_id
  ) values (
    p_business_id, v_customer.id, v_session.selected_starts_at, v_ends_at,
    'confirmed', 'whatsapp_ai', v_duration, v_price, v_currency, v_session.staff_id
  ) returning * into v_appointment;

  insert into public.appointment_services (
    business_id, appointment_id, service_id, staff_member_id, position,
    duration_minutes, price, starts_at, ends_at
  ) values (
    p_business_id, v_appointment.id, v_session.service_id, v_session.staff_id, 1,
    v_duration, v_price, v_appointment.starts_at, v_appointment.ends_at
  );

  insert into public.appointment_events (
    business_id, appointment_id, event_type, previous_data, new_data, actor_user_id, source
  ) values (
    p_business_id, v_appointment.id, 'created', null,
    jsonb_build_object('status', 'confirmed', 'starts_at', v_appointment.starts_at,
      'ends_at', v_appointment.ends_at, 'assigned_staff_member_id', v_session.staff_id,
      'service_count', 1), null, 'whatsapp_ai'
  );

  update public.beauty_booking_sessions set
    status = 'completed', appointment_id = v_appointment.id, confirmed_at = now(),
    last_processed_inbound_message_id = p_inbound_message_id,
    handoff_reason = null, last_error_code = null, version = version + 1
  where id = v_session.id;
  update public.beauty_conversations set
    mode = 'ai', assigned_user_id = null, needs_attention = false, attention_reason = null
  where id = p_conversation_id and business_id = p_business_id;

  return query select 'confirmed', v_appointment.id, v_appointment.starts_at,
    v_appointment.ends_at, v_service_name, v_staff_name, v_customer.id,
    '[]'::jsonb, v_session.version + 1;
end;
$$;

revoke all on function public.confirm_beauty_booking_session(uuid, uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.confirm_beauty_booking_session(uuid, uuid, uuid, uuid, integer)
  to service_role;

create or replace function public.record_beauty_booking_confirmation_response(
  p_business_id uuid,
  p_booking_session_id uuid,
  p_inbound_message_id uuid,
  p_response_message_id uuid
) returns void
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
begin
  update public.beauty_booking_sessions set
    last_response_message_id = p_response_message_id,
    version = version + 1
  where id = p_booking_session_id and business_id = p_business_id
    and status = 'completed' and appointment_id is not null
    and last_processed_inbound_message_id = p_inbound_message_id;
  if not found then raise exception 'BOOKING_CONFIRMATION_RESPONSE_CONFLICT' using errcode = '40001'; end if;
end;
$$;
revoke all on function public.record_beauty_booking_confirmation_response(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_beauty_booking_confirmation_response(uuid, uuid, uuid, uuid)
  to service_role;
