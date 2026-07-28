-- Appointments, their service snapshots and append-only audit events.

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references public.beauty_businesses(id) on delete restrict,
  customer_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.beauty_appointment_status not null default 'pending',
  source public.beauty_appointment_source not null default 'manager',
  customer_notes text,
  internal_notes text,
  total_duration_minutes integer not null check (total_duration_minutes > 0),
  total_price numeric(12,2) not null check (total_price >= 0),
  currency varchar(3) not null,
  assigned_staff_member_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancellation_reason text,
  constraint appointments_time_order check (starts_at < ends_at),
  constraint appointments_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint appointments_cancellation_consistency check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status <> 'cancelled' and cancelled_at is null)
  ),
  constraint appointments_customer_business_fk
    foreign key (customer_id, business_id)
    references public.customers(id, business_id) on delete restrict,
  constraint appointments_staff_business_fk
    foreign key (assigned_staff_member_id, business_id)
    references public.staff_members(id, business_id) on delete restrict,
  constraint appointments_id_business_unique unique (id, business_id)
);

create table if not exists public.appointment_services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  appointment_id uuid not null,
  service_id uuid not null,
  staff_member_id uuid not null,
  position integer not null check (position > 0),
  duration_minutes integer not null check (duration_minutes > 0),
  price numeric(12,2) not null check (price >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  constraint appointment_services_time_pair check (
    (starts_at is null and ends_at is null)
    or (starts_at is not null and ends_at is not null and starts_at < ends_at)
  ),
  constraint appointment_services_appointment_business_fk
    foreign key (appointment_id, business_id)
    references public.appointments(id, business_id) on delete restrict,
  constraint appointment_services_service_business_fk
    foreign key (service_id, business_id)
    references public.beauty_services(id, business_id) on delete restrict,
  constraint appointment_services_staff_business_fk
    foreign key (staff_member_id, business_id)
    references public.staff_members(id, business_id) on delete restrict,
  constraint appointment_services_position_unique
    unique (appointment_id, position),
  constraint appointment_services_id_business_unique unique (id, business_id)
);

create table if not exists public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  appointment_id uuid not null,
  event_type public.beauty_appointment_event_type not null,
  previous_data jsonb,
  new_data jsonb,
  actor_user_id uuid references auth.users(id) on delete set null,
  source public.beauty_appointment_source not null,
  created_at timestamptz not null default now(),
  constraint appointment_events_appointment_business_fk
    foreign key (appointment_id, business_id)
    references public.appointments(id, business_id) on delete restrict,
  constraint appointment_events_previous_object
    check (previous_data is null or jsonb_typeof(previous_data) = 'object'),
  constraint appointment_events_new_object
    check (new_data is null or jsonb_typeof(new_data) = 'object'),
  constraint appointment_events_id_business_unique unique (id, business_id)
);

comment on table public.appointment_events is
  'Append-only audit trail. JSON payloads must contain changed fields only, never secrets or complete customer records.';

