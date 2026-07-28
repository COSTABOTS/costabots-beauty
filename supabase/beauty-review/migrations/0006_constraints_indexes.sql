-- Search, tenant-isolation and agenda indexes.

create unique index if not exists beauty_services_business_name_active_uidx
  on public.beauty_services (business_id, lower(btrim(name)))
  where active;

create unique index if not exists customers_business_phone_normalized_uidx
  on public.customers (business_id, phone_normalized)
  where phone_normalized is not null;

create index if not exists business_members_user_active_idx
  on public.business_members (user_id, business_id)
  where active;

create index if not exists staff_members_business_active_sort_idx
  on public.staff_members (business_id, active, sort_order);

create index if not exists beauty_services_business_active_idx
  on public.beauty_services (business_id, active);

create index if not exists staff_services_service_staff_active_idx
  on public.staff_services (business_id, service_id, staff_member_id)
  where active;

create index if not exists staff_schedules_lookup_idx
  on public.staff_schedules (business_id, staff_member_id, day_of_week)
  where active;

create index if not exists time_blocks_business_period_idx
  on public.time_blocks (business_id, starts_at, ends_at);

create index if not exists time_blocks_staff_period_idx
  on public.time_blocks (business_id, staff_member_id, starts_at, ends_at);

create index if not exists customers_business_name_idx
  on public.customers (business_id, lower(first_name), lower(coalesce(last_name, '')));

create index if not exists appointments_business_agenda_idx
  on public.appointments (business_id, starts_at);

create index if not exists appointments_staff_agenda_idx
  on public.appointments (business_id, assigned_staff_member_id, starts_at);

create index if not exists appointments_customer_history_idx
  on public.appointments (business_id, customer_id, starts_at desc);

create index if not exists appointments_active_overlap_idx
  on public.appointments (business_id, assigned_staff_member_id, starts_at, ends_at)
  where status <> 'cancelled';

create index if not exists appointment_services_appointment_idx
  on public.appointment_services (business_id, appointment_id, position);

create index if not exists appointment_events_history_idx
  on public.appointment_events (business_id, appointment_id, created_at);

