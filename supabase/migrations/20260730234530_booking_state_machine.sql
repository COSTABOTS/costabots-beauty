-- Persistent, server-only booking state for the Beauty WhatsApp receptionist.
-- This migration is additive. It does not create sessions for historical conversations.

create or replace function public.beauty_booking_options_valid(p_options jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when jsonb_typeof(p_options) <> 'array' then false
    else jsonb_array_length(p_options) <= 50
    and not exists (
      select 1
      from jsonb_array_elements(p_options) option
      where jsonb_typeof(option) <> 'object'
        or not (option ?& array['starts_at', 'staff_id', 'label'])
        or option->>'starts_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$'
        or option->>'staff_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or option->>'label' !~ '^(?:[01]\d|2[0-3]):[0-5]\d$'
        or substring(option->>'starts_at' from 'T(\d{2}:\d{2})') <> option->>'label'
    )
    and (
      select count(*)
      from jsonb_array_elements(p_options)
    ) = (
      select count(distinct (option->>'starts_at', option->>'staff_id'))
      from jsonb_array_elements(p_options) option
    )
  end;
$$;

create or replace function public.beauty_booking_selection_valid(
  p_options jsonb,
  p_selected_starts_at timestamptz,
  p_staff_id uuid
) returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case
    when p_selected_starts_at is null then true
    when p_staff_id is null or not public.beauty_booking_options_valid(p_options) then false
    else exists (
      select 1
      from jsonb_array_elements(p_options) option
      where (option->>'starts_at')::timestamptz = p_selected_starts_at
        and (option->>'staff_id')::uuid = p_staff_id
    )
  end;
$$;

create table if not exists public.beauty_booking_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.beauty_businesses(id) on delete cascade,
  conversation_id uuid not null references public.beauty_conversations(id) on delete cascade,
  status text not null check (status in (
    'idle',
    'choosing_service',
    'choosing_date',
    'choosing_time',
    'awaiting_confirmation',
    'awaiting_human_confirmation',
    'completed',
    'cancelled',
    'expired'
  )),
  service_id uuid references public.beauty_services(id) on delete set null,
  staff_id uuid references public.staff_members(id) on delete set null,
  selected_date date,
  offered_times jsonb not null default '[]'::jsonb
    check (public.beauty_booking_options_valid(offered_times)),
  selected_starts_at timestamptz,
  source_ai_run_id uuid references public.beauty_ai_runs(id) on delete set null,
  last_processed_inbound_message_id uuid references public.beauty_messages(id) on delete set null,
  last_response_message_id uuid references public.beauty_messages(id) on delete set null,
  last_interpretation_intent text check (
    last_interpretation_intent is null or last_interpretation_intent in (
      'ask_information',
      'choose_service',
      'choose_date',
      'choose_time',
      'confirm',
      'reject',
      'change_selection',
      'request_human',
      'unknown'
    )
  ),
  last_error_code text check (
    last_error_code is null or last_error_code in (
      'INTERPRETATION_INVALID',
      'INTERPRETATION_LOW_CONFIDENCE',
      'SERVICE_NOT_RESOLVED',
      'DATE_INVALID',
      'DATE_OUT_OF_RANGE',
      'TIME_NOT_OFFERED',
      'OFFER_EXPIRED',
      'AVAILABILITY_CHANGED',
      'AVAILABILITY_UNAVAILABLE',
      'SESSION_CONFLICT',
      'MESSAGE_SEND_FAILED',
      'MANUAL_TAKEOVER',
      'SUPERSEDED_BY_NEWER_INBOUND'
    )
  ),
  handoff_reason text check (
    handoff_reason is null or handoff_reason in (
      'booking_confirmation',
      'requested',
      'complaint',
      'urgent',
      'confused',
      'unsupported'
    )
  ),
  version integer not null default 1 check (version > 0),
  availability_checked_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_booking_session_selected_option_check
    check (public.beauty_booking_selection_valid(offered_times, selected_starts_at, staff_id)),
  constraint beauty_booking_session_expiry_check
    check (expires_at > created_at),
  constraint beauty_booking_session_state_shape_check
    check (
      (status = 'idle' and last_error_code = 'INTERPRETATION_INVALID')
      or status <> 'idle'
    )
);

create unique index if not exists beauty_booking_sessions_one_active_conversation_idx
  on public.beauty_booking_sessions (conversation_id)
  where status in (
    'idle',
    'choosing_service',
    'choosing_date',
    'choosing_time',
    'awaiting_confirmation',
    'awaiting_human_confirmation'
  );

create unique index if not exists beauty_booking_sessions_inbound_once_idx
  on public.beauty_booking_sessions (last_processed_inbound_message_id)
  where last_processed_inbound_message_id is not null;

create index if not exists beauty_booking_sessions_business_status_idx
  on public.beauty_booking_sessions (business_id, status, expires_at);

drop trigger if exists beauty_set_updated_at on public.beauty_booking_sessions;
create trigger beauty_set_updated_at
before update on public.beauty_booking_sessions
for each row execute function public.beauty_set_updated_at();

alter table public.beauty_booking_sessions enable row level security;
alter table public.beauty_booking_sessions force row level security;

revoke all on table public.beauty_booking_sessions from public, anon, authenticated;
grant select, insert, update on table public.beauty_booking_sessions to service_role;

revoke execute on function public.beauty_booking_options_valid(jsonb)
  from public, anon, authenticated;
revoke execute on function public.beauty_booking_selection_valid(jsonb, timestamptz, uuid)
  from public, anon, authenticated;

comment on table public.beauty_booking_sessions is
  'Server-only source of truth for deterministic Beauty booking conversations. Historical messages never create sessions automatically.';
comment on column public.beauty_booking_sessions.offered_times is
  'Validated options containing only starts_at, staff_id and display label; no customer or staff personal data.';
comment on column public.beauty_booking_sessions.last_interpretation_intent is
  'Controlled intent code only. Raw Gemini output is never persisted.';
comment on column public.beauty_booking_sessions.last_error_code is
  'Sanitized domain error code. Upstream payloads and free-form error messages are forbidden.';
