-- Realtime is read through the existing authenticated RLS policies.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'beauty_conversations'
  ) then
    alter publication supabase_realtime add table public.beauty_conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'beauty_messages'
  ) then
    alter publication supabase_realtime add table public.beauty_messages;
  end if;
end
$$;
