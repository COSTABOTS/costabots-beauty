-- COSTABOTS Beauty review schema. Do not apply to a remote project yet.

do $$
begin
  create type public.beauty_member_role as enum ('owner', 'admin', 'staff');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.beauty_appointment_status as enum (
    'pending', 'confirmed', 'arrived', 'in_service',
    'completed', 'cancelled', 'no_show'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.beauty_appointment_source as enum (
    'manager', 'whatsapp_ai', 'web', 'phone', 'walk_in', 'imported'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.beauty_time_block_type as enum (
    'break', 'absence', 'vacation', 'personal',
    'business_closed', 'other'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.beauty_appointment_event_type as enum (
    'created', 'updated', 'status_changed',
    'rescheduled', 'cancelled', 'note_added'
  );
exception when duplicate_object then null;
end $$;

