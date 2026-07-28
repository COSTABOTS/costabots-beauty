-- Shared updated_at trigger. Explicit search_path avoids object shadowing.

create or replace function public.beauty_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.beauty_set_updated_at() from public;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'beauty_businesses',
    'business_members',
    'staff_members',
    'beauty_services',
    'staff_schedules',
    'time_blocks',
    'customers',
    'appointments'
  ]
  loop
    execute format(
      'drop trigger if exists beauty_set_updated_at on public.%I',
      table_name
    );
    execute format(
      'create trigger beauty_set_updated_at before update on public.%I
       for each row execute function public.beauty_set_updated_at()',
      table_name
    );
  end loop;
end;
$$;

