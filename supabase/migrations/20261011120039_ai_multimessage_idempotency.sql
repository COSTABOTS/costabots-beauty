-- One AI run can legitimately emit a confirmation followed by a consent
-- question. Keep those reservations independently idempotent while retaining
-- the latest-inbound guard for every permitted identifier shape.

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
  v_match text[];
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.conversation_id::text, 0)
  );

  if new.sender_type = 'ai' and new.client_request_id like 'ai-run-%' then
    v_match := pg_catalog.regexp_match(
      new.client_request_id,
      '^ai-run-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})(?:-(?:confirmation|reminder-consent))?$'
    );
    if v_match is null then
      raise exception 'AI_RESPONSE_REQUEST_ID_INVALID' using errcode = '22023';
    end if;
    v_run_id := v_match[1]::uuid;

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

comment on function public.beauty_guard_ai_message_reservation() is
  'Rejects AI responses from stale runs and unsupported ai-run idempotency purposes.';
