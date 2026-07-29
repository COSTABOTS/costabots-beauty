-- First narrowly-scoped Manager writes for authenticated COSTABOTS Beauty users.
-- Appointment and block fields not listed in these signatures cannot be changed.

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
    (v_previous_status = 'pending' and p_new_status = 'confirmed')
    or (v_previous_status = 'confirmed' and p_new_status in ('arrived', 'no_show'))
    or (v_previous_status = 'arrived' and p_new_status = 'in_service')
    or (v_previous_status = 'in_service' and p_new_status = 'completed')
  ) then
    raise exception 'Invalid appointment status transition'
      using errcode = '22023';
  end if;

  update public.appointments a
  set status = p_new_status,
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

create or replace function public.create_beauty_time_block(
  p_business_id uuid,
  p_staff_member_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_block_type public.beauty_time_block_type,
  p_reason text default null,
  p_notes text default null
)
returns public.time_blocks
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_block public.time_blocks;
  v_is_manager boolean;
  v_current_staff_id uuid;
begin
  if auth.uid() is null or not public.is_business_member(p_business_id) then
    raise exception 'Not authorized for this Beauty business'
      using errcode = '42501';
  end if;

  if p_starts_at is null or p_ends_at is null or p_starts_at >= p_ends_at then
    raise exception 'Time block start must be earlier than end'
      using errcode = '22023';
  end if;

  if p_ends_at - p_starts_at > interval '31 days' then
    raise exception 'Time block cannot be longer than 31 days'
      using errcode = '22023';
  end if;

  v_is_manager := public.has_business_role(
    p_business_id, array['owner', 'admin']
  );
  v_current_staff_id := public.current_staff_member_id(p_business_id);

  if p_staff_member_id is null then
    if not v_is_manager then
      raise exception 'Only owner or admin may create global blocks'
        using errcode = '42501';
    end if;
    if p_block_type not in ('business_closed', 'other') then
      raise exception 'Global blocks must be business_closed or other'
        using errcode = '22023';
    end if;
  else
    if not exists (
      select 1
      from public.staff_members sm
      where sm.id = p_staff_member_id
        and sm.business_id = p_business_id
        and sm.active
    ) then
      raise exception 'Professional not found in this Beauty business'
        using errcode = 'P0002';
    end if;

    if not v_is_manager and (
      v_current_staff_id is distinct from p_staff_member_id
      or p_block_type not in ('break', 'personal', 'other')
    ) then
      raise exception 'Staff may only create allowed blocks for themselves'
        using errcode = '42501';
    end if;
  end if;

  insert into public.time_blocks (
    business_id, staff_member_id, starts_at, ends_at,
    block_type, reason, notes, created_by
  )
  values (
    p_business_id,
    p_staff_member_id,
    p_starts_at,
    p_ends_at,
    p_block_type,
    nullif(btrim(p_reason), ''),
    nullif(btrim(p_notes), ''),
    auth.uid()
  )
  returning * into v_block;

  return v_block;
end;
$$;

revoke all on function public.create_beauty_time_block(
  uuid, uuid, timestamptz, timestamptz,
  public.beauty_time_block_type, text, text
) from public, anon;
grant execute on function public.create_beauty_time_block(
  uuid, uuid, timestamptz, timestamptz,
  public.beauty_time_block_type, text, text
) to authenticated;
