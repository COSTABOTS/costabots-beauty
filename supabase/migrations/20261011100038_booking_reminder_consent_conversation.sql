-- Conversational consent for the day-before reminder. This migration creates
-- no scheduler, dispatcher, or provider delivery path.

create or replace function public.resolve_beauty_reminder_consent_response(
  p_business_id uuid,
  p_conversation_id uuid,
  p_booking_session_id uuid,
  p_prompt_message_id uuid,
  p_inbound_message_id uuid,
  p_choice text,
  p_run_id uuid
) returns table (
  handled boolean,
  reminder_status text,
  consent_status text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.beauty_booking_sessions;
  v_reminder public.beauty_appointment_reminders;
  v_appointment public.appointments;
  v_customer public.customers;
  v_prompt_valid boolean;
  v_prompt_sent_at timestamptz;
  v_next_reminder_status text;
begin
  if p_choice not in ('granted', 'denied', 'defer') then
    raise exception 'REMINDER_CONSENT_CHOICE_INVALID' using errcode = '22023';
  end if;
  if p_run_id is not null and not exists (
    select 1 from public.beauty_ai_runs
    where id = p_run_id and business_id = p_business_id
  ) then
    raise exception 'REMINDER_CONSENT_RUN_INVALID' using errcode = '22023';
  end if;

  select * into v_session
  from public.beauty_booking_sessions
  where id = p_booking_session_id
    and business_id = p_business_id
    and conversation_id = p_conversation_id
    and status = 'completed'
    and appointment_id is not null
    and last_response_message_id = p_prompt_message_id
  for update;
  if not found then
    return query select false, null::text, null::text;
    return;
  end if;

  select sent_at into v_prompt_sent_at
  from public.beauty_messages
  where id = p_prompt_message_id
    and business_id = p_business_id
    and conversation_id = p_conversation_id
    and direction = 'outbound'
    and sender_type = 'ai'
    and text_content = '¿Quieres que te recuerde tus citas por WhatsApp el día anterior?';
  v_prompt_valid := v_prompt_sent_at is not null;
  if not v_prompt_valid then
    raise exception 'REMINDER_CONSENT_PROMPT_INVALID' using errcode = '22023';
  end if;

  -- An old prompt must not hijack a later conversation. Defer clears only its
  -- marker; affirmative/negative input is not accepted after this short TTL.
  if v_prompt_sent_at < now() - interval '30 minutes' then
    update public.beauty_booking_sessions
    set last_response_message_id = null,
        last_processed_inbound_message_id = p_inbound_message_id,
        source_ai_run_id = p_run_id,
        version = version + 1
    where id = v_session.id and version = v_session.version;
    return query select false, null::text, null::text;
    return;
  end if;

  select * into v_reminder
  from public.beauty_appointment_reminders
  where business_id = p_business_id
    and appointment_id = v_session.appointment_id
    and conversation_id = p_conversation_id
    and kind = 'day_before'
    and status = 'awaiting_consent'
  for update;
  if not found then
    update public.beauty_booking_sessions
    set last_response_message_id = null,
        last_processed_inbound_message_id = p_inbound_message_id,
        source_ai_run_id = p_run_id,
        version = version + 1
    where id = v_session.id and version = v_session.version;
    return query select true, null::text, null::text;
    return;
  end if;

  select * into v_appointment
  from public.appointments
  where id = v_reminder.appointment_id and business_id = p_business_id
  for update;
  select * into v_customer
  from public.customers
  where id = v_appointment.customer_id and business_id = p_business_id
  for update;
  if not found then
    raise exception 'REMINDER_CONSENT_CUSTOMER_INVALID' using errcode = '22023';
  end if;

  if p_choice = 'granted' and v_customer.reminder_consent_status = 'unknown' then
    update public.customers
    set reminder_consent_status = 'granted', reminder_consent_decided_at = now()
    where id = v_customer.id and business_id = p_business_id;
    if v_appointment.status = 'cancelled' then
      v_next_reminder_status := 'cancelled';
    elsif v_appointment.starts_at <= now() + interval '24 hours' then
      v_next_reminder_status := 'skipped';
    else
      v_next_reminder_status := 'pending';
    end if;
    update public.beauty_appointment_reminders
    set status = v_next_reminder_status,
        skip_reason = case when v_next_reminder_status = 'skipped' then 'TOO_LATE' else null end,
        next_attempt_at = case when v_next_reminder_status = 'pending' then due_at else null end,
        cancelled_at = case when v_next_reminder_status = 'cancelled' then now() else null end,
        locked_at = null,
        lock_token = null
    where id = v_reminder.id;
  elsif p_choice = 'denied' and v_customer.reminder_consent_status = 'unknown' then
    update public.customers
    set reminder_consent_status = 'denied', reminder_consent_decided_at = now()
    where id = v_customer.id and business_id = p_business_id;
    v_next_reminder_status := 'skipped';
    update public.beauty_appointment_reminders
    set status = 'skipped', skip_reason = 'CONSENT_DENIED', next_attempt_at = null,
        locked_at = null, lock_token = null
    where id = v_reminder.id;
  else
    v_next_reminder_status := v_reminder.status;
  end if;

  update public.beauty_booking_sessions
  set last_response_message_id = null,
      last_processed_inbound_message_id = p_inbound_message_id,
      source_ai_run_id = p_run_id,
      version = version + 1
  where id = v_session.id and version = v_session.version;
  if not found then
    raise exception 'REMINDER_CONSENT_SESSION_CONFLICT' using errcode = '40001';
  end if;

  return query select true, v_next_reminder_status, case
    when p_choice = 'defer' then v_customer.reminder_consent_status
    else p_choice
  end;
end;
$$;

create or replace function public.record_beauty_reminder_consent_prompt(
  p_business_id uuid,
  p_conversation_id uuid,
  p_booking_session_id uuid,
  p_inbound_message_id uuid,
  p_prompt_message_id uuid
) returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated boolean;
begin
  update public.beauty_booking_sessions booking_session
  set last_response_message_id = p_prompt_message_id,
      version = booking_session.version + 1
  where booking_session.id = p_booking_session_id
    and booking_session.business_id = p_business_id
    and booking_session.conversation_id = p_conversation_id
    and booking_session.status = 'completed'
    and booking_session.appointment_id is not null
    and booking_session.last_processed_inbound_message_id = p_inbound_message_id
    and exists (
      select 1 from public.beauty_messages prompt
      where prompt.id = p_prompt_message_id
        and prompt.business_id = p_business_id
        and prompt.conversation_id = p_conversation_id
        and prompt.direction = 'outbound'
        and prompt.sender_type = 'ai'
        and prompt.text_content = '¿Quieres que te recuerde tus citas por WhatsApp el día anterior?'
    )
    and exists (
      select 1
      from public.beauty_appointment_reminders reminder
      join public.appointments appointment
        on appointment.id = reminder.appointment_id
       and appointment.business_id = reminder.business_id
      join public.customers customer
        on customer.id = appointment.customer_id
       and customer.business_id = appointment.business_id
      where reminder.business_id = p_business_id
        and reminder.appointment_id = booking_session.appointment_id
        and reminder.conversation_id = p_conversation_id
        and reminder.kind = 'day_before'
        and reminder.status = 'awaiting_consent'
        and customer.reminder_consent_status = 'unknown'
    )
  returning true into v_updated;
  return coalesce(v_updated, false);
end;
$$;

revoke all on function public.resolve_beauty_reminder_consent_response(uuid, uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.record_beauty_reminder_consent_prompt(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_beauty_reminder_consent_response(uuid, uuid, uuid, uuid, uuid, text, uuid)
  to service_role;
grant execute on function public.record_beauty_reminder_consent_prompt(uuid, uuid, uuid, uuid, uuid)
  to service_role;
