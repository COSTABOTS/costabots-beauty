-- Keep the appointment cancellation consistency constraint satisfied.
-- This replaces only the status RPC applied in migration 15.

create or replace function public.update_beauty_appointment_status(
  p_business_id uuid,
  p_appointment_id uuid,
  p_new_status public.beauty_appointment_status
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_appointment public.appointments;
  v_previous_status public.beauty_appointment_status;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'Not authorized for this Beauty business'
      using errcode = '42501';
  end if;

  select a.*
    into v_appointment
  from public.appointments a
  where a.id = p_appointment_id
    and a.business_id = p_business_id
  for update;

  if not found then
    raise exception 'Appointment not found in this Beauty business'
      using errcode = 'P0002';
  end if;

  if not (
    public.has_business_role(p_business_id, array['owner', 'admin'])
    or public.current_staff_member_id(p_business_id) =
       v_appointment.assigned_staff_member_id
  ) then
    raise exception 'Not allowed to update this appointment'
      using errcode = '42501';
  end if;

  v_previous_status := v_appointment.status;
  if not (
    (v_previous_status = 'pending' and p_new_status in ('confirmed', 'cancelled'))
    or (v_previous_status = 'confirmed' and p_new_status in ('completed', 'no_show', 'cancelled'))
    or (v_previous_status = 'arrived' and p_new_status = 'completed')
    or (v_previous_status = 'in_service' and p_new_status = 'completed')
  ) then
    raise exception 'Invalid appointment status transition'
      using errcode = '22023';
  end if;

  update public.appointments a
  set status = p_new_status,
      cancelled_at = case
        when p_new_status = 'cancelled' then now()
        else a.cancelled_at
      end,
      updated_at = now()
  where a.id = p_appointment_id
    and a.business_id = p_business_id
  returning a.* into v_appointment;

  insert into public.appointment_events (
    business_id, appointment_id, event_type,
    previous_data, new_data, actor_user_id, source
  )
  values (
    p_business_id,
    p_appointment_id,
    'status_changed',
    jsonb_build_object('status', v_previous_status),
    jsonb_build_object('status', p_new_status),
    auth.uid(),
    'manager'
  );

  return v_appointment;
end;
$$;

revoke all on function public.update_beauty_appointment_status(
  uuid, uuid, public.beauty_appointment_status
) from public, anon;
grant execute on function public.update_beauty_appointment_status(
  uuid, uuid, public.beauty_appointment_status
) to authenticated;
