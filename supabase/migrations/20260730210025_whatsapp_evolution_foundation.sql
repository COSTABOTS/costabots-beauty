-- WhatsApp foundation for COSTABOTS Beauty.
-- Provider credentials and QR values never live in these frontend-readable tables.

create table if not exists public.beauty_whatsapp_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.beauty_businesses(id) on delete cascade,
  provider text not null default 'evolution' check (provider = 'evolution'),
  instance_name text not null,
  instance_external_id text,
  connection_status text not null default 'not_provisioned'
    check (connection_status in ('not_provisioned','provisioning','awaiting_qr','connecting','connected','disconnected','error')),
  phone_number text,
  display_name text,
  qr_status text not null default 'unavailable'
    check (qr_status in ('unavailable','available','expired','scanned')),
  connected_at timestamptz,
  disconnected_at timestamptz,
  activated_at timestamptz,
  last_event_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_whatsapp_connections_business_unique unique (business_id),
  constraint beauty_whatsapp_connections_instance_unique unique (instance_name),
  constraint beauty_whatsapp_connections_instance_name_check
    check (instance_name ~ '^beauty_[a-f0-9]{8}_[a-z0-9]{10}$')
);

create table if not exists public.beauty_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.beauty_businesses(id) on delete cascade,
  whatsapp_connection_id uuid not null references public.beauty_whatsapp_connections(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  remote_jid text not null,
  remote_phone_normalized text,
  contact_name text,
  profile_picture_url text,
  mode text not null default 'ai' check (mode in ('ai','manual')),
  needs_attention boolean not null default false,
  attention_reason text,
  assigned_user_id uuid references auth.users(id) on delete set null,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  last_message_preview text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beauty_conversations_remote_unique unique (whatsapp_connection_id, remote_jid)
);

create table if not exists public.beauty_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.beauty_businesses(id) on delete cascade,
  conversation_id uuid not null references public.beauty_conversations(id) on delete cascade,
  provider_message_id text not null,
  direction text not null check (direction in ('inbound','outbound')),
  sender_type text not null check (sender_type in ('customer','human','ai','system')),
  message_type text not null check (message_type in ('text','image','audio','document','video','location','contact','unknown')),
  text_content text,
  media_url text,
  media_mime_type text,
  quoted_message_id text,
  status text not null default 'received'
    check (status in ('pending','sent','received','delivered','read','failed')),
  sent_at timestamptz not null,
  delivered_at timestamptz,
  read_at timestamptz,
  raw_event_reference uuid,
  created_at timestamptz not null default now(),
  constraint beauty_messages_provider_unique unique (conversation_id, provider_message_id),
  constraint beauty_messages_text_length check (text_content is null or char_length(text_content) <= 4096)
);

create table if not exists public.beauty_whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  business_id uuid references public.beauty_businesses(id) on delete cascade,
  instance_name text not null,
  event_type text not null,
  provider_message_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_status text not null default 'received'
    check (processing_status in ('received','processed','ignored','failed')),
  error_message text,
  payload_summary jsonb,
  constraint beauty_webhook_payload_summary_size check (payload_summary is null or pg_column_size(payload_summary) <= 8192)
);

alter table public.beauty_messages
  drop constraint if exists beauty_messages_raw_event_reference_fkey;
alter table public.beauty_messages
  add constraint beauty_messages_raw_event_reference_fkey
  foreign key (raw_event_reference) references public.beauty_whatsapp_webhook_events(id) on delete set null;

create index if not exists beauty_conversations_business_last_message_idx
  on public.beauty_conversations (business_id, last_message_at desc);
create index if not exists beauty_conversations_attention_idx
  on public.beauty_conversations (business_id, needs_attention, last_message_at desc)
  where active;
create index if not exists beauty_messages_conversation_sent_idx
  on public.beauty_messages (conversation_id, sent_at desc);
create index if not exists beauty_webhook_events_received_idx
  on public.beauty_whatsapp_webhook_events (received_at desc);

drop trigger if exists beauty_set_updated_at on public.beauty_whatsapp_connections;
create trigger beauty_set_updated_at before update on public.beauty_whatsapp_connections
for each row execute function public.beauty_set_updated_at();
drop trigger if exists beauty_set_updated_at on public.beauty_conversations;
create trigger beauty_set_updated_at before update on public.beauty_conversations
for each row execute function public.beauty_set_updated_at();

alter table public.beauty_whatsapp_connections enable row level security;
alter table public.beauty_whatsapp_connections force row level security;
alter table public.beauty_conversations enable row level security;
alter table public.beauty_conversations force row level security;
alter table public.beauty_messages enable row level security;
alter table public.beauty_messages force row level security;
alter table public.beauty_whatsapp_webhook_events enable row level security;
alter table public.beauty_whatsapp_webhook_events force row level security;

drop policy if exists beauty_whatsapp_connections_select_members on public.beauty_whatsapp_connections;
create policy beauty_whatsapp_connections_select_members
on public.beauty_whatsapp_connections for select to authenticated
using (public.is_business_member(business_id));

drop policy if exists beauty_conversations_select_members on public.beauty_conversations;
create policy beauty_conversations_select_members
on public.beauty_conversations for select to authenticated
using (public.is_business_member(business_id));

drop policy if exists beauty_messages_select_members on public.beauty_messages;
create policy beauty_messages_select_members
on public.beauty_messages for select to authenticated
using (public.is_business_member(business_id));

-- Webhook audit rows contain technical metadata and are server-only.
-- No direct INSERT/UPDATE/DELETE policies are created on any WhatsApp table.

create or replace function public.get_beauty_whatsapp_connection(
  p_business_id uuid
)
returns table (
  id uuid,
  connection_status text,
  phone_number text,
  display_name text,
  connected_at timestamptz,
  last_error_code text,
  last_error_message text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_business_member(p_business_id) then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_BUSINESS_PERMISSION';
  end if;
  return query
  select c.id, c.connection_status, c.phone_number, c.display_name,
         c.connected_at, c.last_error_code, c.last_error_message
  from public.beauty_whatsapp_connections c
  where c.business_id = p_business_id;
end;
$$;

-- Internal instance names are not exposed through direct table SELECT.
revoke all on table public.beauty_whatsapp_connections from anon;
revoke all on table public.beauty_whatsapp_connections from authenticated;
revoke all on function public.get_beauty_whatsapp_connection(uuid) from public;
revoke all on function public.get_beauty_whatsapp_connection(uuid) from anon;
grant execute on function public.get_beauty_whatsapp_connection(uuid) to authenticated;

create or replace function public.take_beauty_conversation(
  p_conversation_id uuid
)
returns public.beauty_conversations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_conversation public.beauty_conversations;
begin
  select *
  into v_conversation
  from public.beauty_conversations
  where id = p_conversation_id
  for update;

  if v_conversation.id is null then
    raise exception using errcode = 'P0002', message = 'CONVERSATION_NOT_FOUND';
  end if;
  if not public.has_business_role(v_conversation.business_id, array['owner','admin','staff']) then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_BUSINESS_PERMISSION';
  end if;
  if v_conversation.mode = 'manual'
     and v_conversation.assigned_user_id is not null
     and v_conversation.assigned_user_id <> auth.uid() then
    raise exception using errcode = '40001', message = 'CONVERSATION_ALREADY_ASSIGNED';
  end if;

  update public.beauty_conversations
  set mode = 'manual',
      needs_attention = false,
      attention_reason = null,
      assigned_user_id = auth.uid()
  where id = p_conversation_id
  returning * into v_conversation;
  return v_conversation;
end;
$$;

create or replace function public.release_beauty_conversation(
  p_conversation_id uuid
)
returns public.beauty_conversations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_conversation public.beauty_conversations;
begin
  select *
  into v_conversation
  from public.beauty_conversations
  where id = p_conversation_id
  for update;

  if v_conversation.id is null then
    raise exception using errcode = 'P0002', message = 'CONVERSATION_NOT_FOUND';
  end if;
  if not public.has_business_role(v_conversation.business_id, array['owner','admin','staff']) then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_BUSINESS_PERMISSION';
  end if;
  if v_conversation.assigned_user_id is not null
     and v_conversation.assigned_user_id <> auth.uid()
     and not public.has_business_role(v_conversation.business_id, array['owner','admin']) then
    raise exception using errcode = '42501', message = 'CONVERSATION_ASSIGNED_TO_ANOTHER_USER';
  end if;

  update public.beauty_conversations
  set mode = 'ai',
      assigned_user_id = null,
      needs_attention = false,
      attention_reason = null
  where id = p_conversation_id
  returning * into v_conversation;
  return v_conversation;
end;
$$;

create or replace function public.increment_beauty_conversation_unread(
  p_conversation_id uuid
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.beauty_conversations
  set unread_count = unread_count + 1
  where id = p_conversation_id;
$$;

create or replace function public.mark_beauty_conversation_read(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_business_id uuid;
begin
  select business_id into v_business_id
  from public.beauty_conversations
  where id = p_conversation_id;
  if v_business_id is null then
    raise exception using errcode = 'P0002', message = 'CONVERSATION_NOT_FOUND';
  end if;
  if not public.is_business_member(v_business_id) then
    raise exception using errcode = '42501', message = 'INSUFFICIENT_BUSINESS_PERMISSION';
  end if;
  update public.beauty_conversations set unread_count = 0 where id = p_conversation_id;
end;
$$;

revoke all on function public.take_beauty_conversation(uuid) from public;
revoke all on function public.take_beauty_conversation(uuid) from anon;
grant execute on function public.take_beauty_conversation(uuid) to authenticated;
revoke all on function public.release_beauty_conversation(uuid) from public;
revoke all on function public.release_beauty_conversation(uuid) from anon;
grant execute on function public.release_beauty_conversation(uuid) to authenticated;
revoke all on function public.increment_beauty_conversation_unread(uuid) from public;
revoke all on function public.increment_beauty_conversation_unread(uuid) from anon;
revoke all on function public.increment_beauty_conversation_unread(uuid) from authenticated;
grant execute on function public.increment_beauty_conversation_unread(uuid) to service_role;
revoke all on function public.mark_beauty_conversation_read(uuid) from public;
revoke all on function public.mark_beauty_conversation_read(uuid) from anon;
grant execute on function public.mark_beauty_conversation_read(uuid) to authenticated;

comment on table public.beauty_whatsapp_webhook_events is
  'Reduced technical webhook audit. Retention must be enforced operationally; full provider payloads and QR values are forbidden.';
