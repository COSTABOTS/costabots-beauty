-- Professionals, service catalogue and their many-to-many assignment.

create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references public.beauty_businesses(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  phone text,
  email text,
  color_key text not null default 'coral'
    check (color_key ~ '^[a-z0-9_-]{1,32}$'),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_members_id_business_unique unique (id, business_id),
  constraint staff_members_business_user_unique unique (business_id, user_id)
);

create table if not exists public.beauty_services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references public.beauty_businesses(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 160),
  description text,
  duration_minutes integer not null check (duration_minutes > 0),
  buffer_before_minutes integer not null default 0
    check (buffer_before_minutes >= 0),
  buffer_after_minutes integer not null default 0
    check (buffer_after_minutes >= 0),
  price numeric(12,2) not null check (price >= 0),
  currency varchar(3) not null,
  active boolean not null default true,
  online_booking_enabled boolean not null default true,
  reactivation_days integer check (reactivation_days is null or reactivation_days > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_services_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint beauty_services_id_business_unique unique (id, business_id)
);

create table if not exists public.staff_services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  staff_member_id uuid not null,
  service_id uuid not null,
  custom_duration_minutes integer
    check (custom_duration_minutes is null or custom_duration_minutes > 0),
  custom_price numeric(12,2)
    check (custom_price is null or custom_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint staff_services_staff_business_fk
    foreign key (staff_member_id, business_id)
    references public.staff_members(id, business_id) on delete restrict,
  constraint staff_services_service_business_fk
    foreign key (service_id, business_id)
    references public.beauty_services(id, business_id) on delete restrict,
  constraint staff_services_assignment_unique
    unique (business_id, staff_member_id, service_id),
  constraint staff_services_id_business_unique unique (id, business_id)
);

