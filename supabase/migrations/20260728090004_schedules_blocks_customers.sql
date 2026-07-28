-- Weekly schedules, exceptional blocks and customers.
-- day_of_week follows ISO numbering: Monday=1 through Sunday=7.

create table if not exists public.staff_schedules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  staff_member_id uuid not null,
  day_of_week smallint not null check (day_of_week between 1 and 7),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  valid_from date,
  valid_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_schedules_time_order check (start_time < end_time),
  constraint staff_schedules_validity_order
    check (valid_from is null or valid_until is null or valid_from <= valid_until),
  constraint staff_schedules_staff_business_fk
    foreign key (staff_member_id, business_id)
    references public.staff_members(id, business_id) on delete restrict,
  constraint staff_schedules_natural_unique
    unique (
      business_id, staff_member_id, day_of_week,
      start_time, end_time, valid_from, valid_until
    ),
  constraint staff_schedules_id_business_unique unique (id, business_id)
);

create table if not exists public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references public.beauty_businesses(id) on delete restrict,
  staff_member_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  block_type public.beauty_time_block_type not null,
  reason text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_blocks_time_order check (starts_at < ends_at),
  constraint time_blocks_staff_business_fk
    foreign key (staff_member_id, business_id)
    references public.staff_members(id, business_id) on delete restrict,
  constraint time_blocks_global_type_check
    check (staff_member_id is not null or block_type in ('business_closed', 'other')),
  constraint time_blocks_id_business_unique unique (id, business_id)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references public.beauty_businesses(id) on delete restrict,
  first_name text not null check (length(btrim(first_name)) between 1 and 120),
  last_name text,
  phone text,
  phone_normalized text,
  email text,
  preferred_staff_member_id uuid,
  notes text,
  marketing_consent boolean not null default false,
  reminder_consent boolean not null default false,
  consent_updated_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_phone_normalized_format
    check (phone_normalized is null or phone_normalized ~ '^\+[1-9][0-9]{7,14}$'),
  constraint customers_preferred_staff_business_fk
    foreign key (preferred_staff_member_id, business_id)
    references public.staff_members(id, business_id) on delete restrict,
  constraint customers_id_business_unique unique (id, business_id)
);

comment on column public.customers.phone_normalized is
  'Expected in E.164 format. Full international validation belongs in the trusted API layer.';

