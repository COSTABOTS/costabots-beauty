-- Keep Manager send retries idempotent independently from Evolution's
-- provider message id. This follow-up preserves the already-applied migration 25.

alter table public.beauty_messages
  add column if not exists client_request_id text;

create unique index if not exists beauty_messages_client_request_unique
  on public.beauty_messages (conversation_id, client_request_id)
  where client_request_id is not null;
