-- Controlled AI orchestration for inbound Beauty WhatsApp messages.
-- No prompts, model responses, phone numbers or provider payloads are stored.

create table if not exists public.beauty_ai_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.beauty_businesses(id) on delete cascade,
  conversation_id uuid not null references public.beauty_conversations(id) on delete cascade,
  inbound_message_id uuid not null references public.beauty_messages(id) on delete cascade,
  operation_type text not null default 'auto_reply'
    check (operation_type = 'auto_reply'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'skipped', 'failed')),
  attempt_count integer not null default 0
    check (attempt_count between 0 and 3),
  error_code text
    check (error_code is null or error_code ~ '^[A-Z0-9_]{2,80}$'),
  response_message_id uuid references public.beauty_messages(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_ai_runs_inbound_operation_unique
    unique (inbound_message_id, operation_type)
);

create index if not exists beauty_ai_runs_business_status_idx
  on public.beauty_ai_runs (business_id, status, created_at);

drop trigger if exists beauty_set_updated_at on public.beauty_ai_runs;
create trigger beauty_set_updated_at
before update on public.beauty_ai_runs
for each row execute function public.beauty_set_updated_at();

alter table public.beauty_ai_runs enable row level security;
alter table public.beauty_ai_runs force row level security;

-- AI execution metadata is server-only. Manager users do not need direct access.
revoke all on table public.beauty_ai_runs from public, anon, authenticated;
grant select, insert, update on table public.beauty_ai_runs to service_role;

-- Server-only adapter around the validated Manager availability engine.
-- It establishes a transaction-local member identity solely so the existing
-- tenancy check remains active; all slot calculation stays in the canonical RPC.
create or replace function public.get_beauty_ai_availability(
  p_business_id uuid,
  p_service_id uuid,
  p_date date,
  p_staff_member_id uuid default null,
  p_slot_interval_minutes integer default 15
) returns table (
  staff_member_id uuid,
  staff_display_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  service_duration_minutes integer,
  available boolean
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member_user_id uuid;
  v_timezone text;
  v_staff record;
begin
  select b.timezone
  into v_timezone
  from public.beauty_businesses b
  where b.id = p_business_id
    and b.active;
  if v_timezone is null then
    raise exception 'AI business is unavailable'
      using errcode = 'P0002';
  end if;
  if p_date < (pg_catalog.now() at time zone v_timezone)::date
     or p_date > (pg_catalog.now() at time zone v_timezone)::date + 366 then
    raise exception 'AI availability date is outside the allowed range'
      using errcode = '22023';
  end if;
  if p_slot_interval_minutes not between 5 and 60 then
    raise exception 'AI availability interval is invalid'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.beauty_services s
    where s.id = p_service_id
      and s.business_id = p_business_id
      and s.active
      and s.online_booking_enabled
  ) then
    raise exception 'AI service is unavailable'
      using errcode = 'P0002';
  end if;

  select bm.user_id
  into v_member_user_id
  from public.business_members bm
  where bm.business_id = p_business_id
    and bm.active
  order by
    case bm.role when 'owner' then 1 when 'admin' then 2 else 3 end,
    bm.created_at
  limit 1;
  if v_member_user_id is null then
    raise exception 'AI business has no active Manager member'
      using errcode = '42501';
  end if;

  perform pg_catalog.set_config(
    'request.jwt.claim.sub',
    v_member_user_id::text,
    true
  );

  for v_staff in
    select sm.id, sm.display_name
    from public.staff_members sm
    join public.staff_services ss
      on ss.business_id = sm.business_id
     and ss.staff_member_id = sm.id
     and ss.service_id = p_service_id
     and ss.active
    where sm.business_id = p_business_id
      and sm.active
      and (p_staff_member_id is null or sm.id = p_staff_member_id)
    order by sm.sort_order, sm.display_name
  loop
    return query
    select
      slots.staff_member_id,
      v_staff.display_name,
      slots.starts_at,
      slots.ends_at,
      slots.service_duration_minutes,
      slots.available
    from public.get_multi_service_availability(
      p_business_id,
      array[p_service_id],
      p_date,
      v_staff.id,
      null,
      p_slot_interval_minutes
    ) slots;
  end loop;
end;
$$;

revoke all on function public.get_beauty_ai_availability(
  uuid, uuid, date, uuid, integer
) from public, anon, authenticated;
grant execute on function public.get_beauty_ai_availability(
  uuid, uuid, date, uuid, integer
) to service_role;

comment on table public.beauty_ai_runs is
  'Server-only idempotency and execution state for Beauty AI. Never stores prompts or raw model output.';
comment on function public.get_beauty_ai_availability(
  uuid, uuid, date, uuid, integer
) is
  'Server-only Beauty AI adapter that reuses get_multi_service_availability without duplicating scheduling rules.';
