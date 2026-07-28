-- Core multi-business identity and access membership.

create table if not exists public.beauty_businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  slug text not null,
  timezone text not null default 'Europe/Madrid',
  phone text,
  email text,
  address text,
  default_currency varchar(3) not null default 'EUR',
  default_language varchar(10) not null default 'es',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_businesses_slug_format
    check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint beauty_businesses_currency_format
    check (default_currency ~ '^[A-Z]{3}$'),
  constraint beauty_businesses_language_format
    check (default_language ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  constraint beauty_businesses_slug_unique unique (slug),
  constraint beauty_businesses_id_business_unique unique (id)
);

create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null
    references public.beauty_businesses(id) on delete restrict,
  user_id uuid not null
    references auth.users(id) on delete restrict,
  role public.beauty_member_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_members_business_user_unique
    unique (business_id, user_id),
  constraint business_members_id_business_unique
    unique (id, business_id)
);

comment on table public.business_members is
  'Authorization membership. A professional does not need a row here unless they have Manager access.';

