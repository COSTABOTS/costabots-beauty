-- Persist the explicit professional-selection phase.  The names are
-- customer-visible catalog data only; the final RPC still validates staff and
-- availability from authoritative tables.

create or replace function public.beauty_booking_professionals_valid(p_professionals jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when jsonb_typeof(p_professionals) <> 'array' then false
    else jsonb_array_length(p_professionals) <= 50
    and not exists (
      select 1 from jsonb_array_elements(p_professionals) professional
      where jsonb_typeof(professional) <> 'object'
        or not (professional ?& array['staff_id', 'staff_display_name'])
        or professional->>'staff_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or length(btrim(professional->>'staff_display_name')) not between 1 and 120
    )
  end;
$$;

revoke all on function public.beauty_booking_professionals_valid(jsonb)
  from public, anon, authenticated;
grant execute on function public.beauty_booking_professionals_valid(jsonb)
  to service_role;

alter table public.beauty_booking_sessions
  drop constraint if exists beauty_booking_sessions_status_check;

alter table public.beauty_booking_sessions
  add constraint beauty_booking_sessions_status_check check (status in (
    'idle', 'choosing_service', 'choosing_professional', 'choosing_date',
    'choosing_time', 'awaiting_confirmation', 'awaiting_human_confirmation',
    'completed', 'cancelled', 'expired'
  ));

alter table public.beauty_booking_sessions
  add column if not exists staff_preference text not null default 'unasked'
    check (staff_preference in ('unasked', 'selected', 'indifferent')),
  add column if not exists offered_professionals jsonb not null default '[]'::jsonb
    check (public.beauty_booking_professionals_valid(offered_professionals));

alter table public.beauty_booking_sessions
  drop constraint if exists beauty_booking_session_professional_state_check;

alter table public.beauty_booking_sessions
  add constraint beauty_booking_session_professional_state_check check (
    (status = 'choosing_professional' and staff_id is null and staff_preference = 'unasked'
      and jsonb_array_length(offered_professionals) >= 2)
    or status <> 'choosing_professional'
  );

drop index if exists public.beauty_booking_sessions_one_active_conversation_idx;
create unique index beauty_booking_sessions_one_active_conversation_idx
  on public.beauty_booking_sessions (conversation_id)
  where status in (
    'idle', 'choosing_service', 'choosing_professional', 'choosing_date',
    'choosing_time', 'awaiting_confirmation', 'awaiting_human_confirmation'
  );
