-- Sanitized tool-flow observability and stale-response disposition.
-- Never stores tool arguments, prompts, model responses, phone numbers or provider payloads.

alter table public.beauty_ai_runs
  add column if not exists tool_name text,
  add column if not exists normalized_date date,
  add column if not exists tool_error_category text,
  add column if not exists superseded_by_inbound_message_id uuid
    references public.beauty_messages(id) on delete set null,
  add column if not exists response_disposition text;

alter table public.beauty_ai_runs
  drop constraint if exists beauty_ai_runs_tool_name_check,
  add constraint beauty_ai_runs_tool_name_check
    check (
      tool_name is null
      or tool_name in (
        'get_business_info',
        'list_services',
        'get_availability',
        'request_human_handoff'
      )
    ),
  drop constraint if exists beauty_ai_runs_tool_error_category_check,
  add constraint beauty_ai_runs_tool_error_category_check
    check (
      tool_error_category is null
      or tool_error_category in (
        'invalid_date',
        'date_out_of_range',
        'no_availability',
        'service_not_resolved',
        'tool_internal_error'
      )
    ),
  drop constraint if exists beauty_ai_runs_response_disposition_check,
  add constraint beauty_ai_runs_response_disposition_check
    check (
      response_disposition is null
      or response_disposition in (
        'sent',
        'handoff',
        'skipped_newer_inbound',
        'failed_no_response'
      )
    );

create index if not exists beauty_ai_runs_conversation_created_idx
  on public.beauty_ai_runs (conversation_id, created_at desc);

-- Serialize message insertion per conversation. An AI reservation is rejected
-- atomically when its run no longer targets the latest inbound.
create or replace function public.beauty_guard_ai_message_reservation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_run_id uuid;
  v_run_inbound_id uuid;
  v_latest_inbound_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.conversation_id::text, 0)
  );

  if new.sender_type = 'ai'
     and new.client_request_id ~ '^ai-run-[0-9a-fA-F-]{36}$' then
    v_run_id := pg_catalog.substr(new.client_request_id, 8)::uuid;

    select r.inbound_message_id
    into v_run_inbound_id
    from public.beauty_ai_runs r
    where r.id = v_run_id
      and r.conversation_id = new.conversation_id
      and r.business_id = new.business_id;

    select m.id
    into v_latest_inbound_id
    from public.beauty_messages m
    where m.conversation_id = new.conversation_id
      and m.business_id = new.business_id
      and m.direction = 'inbound'
      and m.sender_type = 'customer'
    order by m.sent_at desc, m.created_at desc
    limit 1;

    if v_run_inbound_id is null
       or v_latest_inbound_id is distinct from v_run_inbound_id then
      raise exception 'AI_RESPONSE_SUPERSEDED'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.beauty_guard_ai_message_reservation() from public, anon, authenticated;

drop trigger if exists beauty_guard_ai_message_reservation on public.beauty_messages;
create trigger beauty_guard_ai_message_reservation
before insert on public.beauty_messages
for each row execute function public.beauty_guard_ai_message_reservation();

comment on column public.beauty_ai_runs.tool_name is
  'Static allow-listed tool name only; never stores arguments.';
comment on column public.beauty_ai_runs.normalized_date is
  'Server-normalized calendar date used for availability; no free text.';
comment on column public.beauty_ai_runs.tool_error_category is
  'Sanitized fixed category for deterministic fallback selection.';
comment on column public.beauty_ai_runs.superseded_by_inbound_message_id is
  'Newer inbound that made this execution obsolete before sending.';
comment on column public.beauty_ai_runs.response_disposition is
  'Sanitized terminal response outcome; never stores response content.';
comment on function public.beauty_guard_ai_message_reservation() is
  'Serializes message insertion by conversation and prevents stale AI outbound reservations.';
