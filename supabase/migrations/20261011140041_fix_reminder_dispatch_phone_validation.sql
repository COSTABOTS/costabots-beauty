-- Correct the E.164 guard used during reminder dispatch. The former regex
-- contained two backslashes, which made valid +E.164 values fail validation.
create or replace function public.prepare_beauty_appointment_reminder_dispatch(
  p_reminder_id uuid,
  p_business_id uuid,
  p_lock_token uuid,
  p_schedule_revision integer
) returns table (outcome text, error_code text, payload jsonb)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reminder public.beauty_appointment_reminders;
  v_appointment public.appointments;
  v_customer public.customers;
  v_conversation public.beauty_conversations;
  v_business public.beauty_businesses;
  v_connection public.beauty_whatsapp_connections;
  v_service_name text;
  v_staff_name text;
  v_service_staff_id uuid;
begin
  select * into v_reminder from public.beauty_appointment_reminders
  where id = p_reminder_id and business_id = p_business_id and status = 'processing'
    and lock_token = p_lock_token and schedule_revision = p_schedule_revision for update;
  if not found then return query select 'not_claimed', 'LOCK_OR_REVISION_MISMATCH', null::jsonb; return; end if;
  select * into v_appointment from public.appointments
  where id = v_reminder.appointment_id and business_id = p_business_id for update;
  if not found then return query select 'skipped', 'APPOINTMENT_NOT_FOUND', null::jsonb; return; end if;
  if v_appointment.status = 'cancelled' then return query select 'cancelled', 'APPOINTMENT_CANCELLED', null::jsonb; return; end if;
  if v_appointment.status <> 'confirmed' then return query select 'skipped', 'APPOINTMENT_NOT_CONFIRMED', null::jsonb; return; end if;
  if v_appointment.starts_at <= now() then return query select 'skipped', 'APPOINTMENT_PASSED', null::jsonb; return; end if;
  select * into v_customer from public.customers
  where id = v_appointment.customer_id and business_id = p_business_id for update;
  if not found or v_customer.reminder_consent_status <> 'granted' then
    return query select 'skipped', 'CONSENT_REVOKED', null::jsonb; return;
  end if;
  select * into v_conversation from public.beauty_conversations
  where id = v_reminder.conversation_id and business_id = p_business_id for update;
  if not found then return query select 'skipped', 'CONVERSATION_INVALID', null::jsonb; return; end if;
  if v_conversation.remote_phone_normalized is null
    or v_conversation.remote_phone_normalized !~ '^[+][1-9][0-9]{7,14}$' then
    return query select 'skipped', 'INVALID_PHONE', null::jsonb; return;
  end if;
  select * into v_business from public.beauty_businesses where id = p_business_id and active;
  if not found or v_business.timezone is null then return query select 'skipped', 'BUSINESS_INVALID', null::jsonb; return; end if;
  select * into v_connection from public.beauty_whatsapp_connections
  where business_id = p_business_id and connection_status = 'connected' order by updated_at desc limit 1;
  if not found then return query select 'retry', 'WHATSAPP_DISCONNECTED', null::jsonb; return; end if;
  select s.name, sm.display_name, aps.staff_member_id into v_service_name, v_staff_name, v_service_staff_id
  from public.appointment_services aps
  join public.beauty_services s on s.id = aps.service_id and s.business_id = aps.business_id
  left join public.staff_members sm on sm.id = aps.staff_member_id and sm.business_id = aps.business_id
  where aps.appointment_id = v_appointment.id and aps.business_id = p_business_id and aps.position = 1;
  if v_service_name is null or v_service_staff_id is distinct from v_appointment.assigned_staff_member_id then
    return query select 'skipped', 'APPOINTMENT_SERVICE_INVALID', null::jsonb; return;
  end if;
  return query select 'ready', null::text, jsonb_build_object(
    'conversationId', v_conversation.id, 'businessName', v_business.name, 'timezone', v_business.timezone,
    'phone', v_conversation.remote_phone_normalized, 'instanceName', v_connection.instance_name,
    'startsAt', v_appointment.starts_at, 'serviceName', v_service_name, 'staffName', v_staff_name
  );
end;
$$;

revoke all on function public.prepare_beauty_appointment_reminder_dispatch(uuid, uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.prepare_beauty_appointment_reminder_dispatch(uuid, uuid, uuid, integer) to service_role;
