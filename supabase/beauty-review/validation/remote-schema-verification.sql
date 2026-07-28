-- Read-only remote catalogue verification for COSTABOTS Beauty.

select json_build_object(
  'tables', (
    select json_agg(tablename order by tablename)
    from pg_catalog.pg_tables
    where schemaname = 'public'
  ),
  'enums', (
    select json_object_agg(enum_name, values)
    from (
      select
        t.typname as enum_name,
        json_agg(e.enumlabel order by e.enumsortorder) as values
      from pg_catalog.pg_type t
      join pg_catalog.pg_namespace n on n.oid = t.typnamespace
      join pg_catalog.pg_enum e on e.enumtypid = t.oid
      where n.nspname = 'public'
        and t.typname like 'beauty_%'
      group by t.typname
    ) enum_values
  ),
  'foreign_keys', (
    select count(*)
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.contype = 'f'
  ),
  'composite_foreign_keys', (
    select count(*)
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public'
      and c.contype = 'f'
      and array_length(c.conkey, 1) = 2
  ),
  'indexes', (
    select count(*)
    from pg_catalog.pg_indexes
    where schemaname = 'public'
  ),
  'rls_enabled_forced', (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'beauty_businesses', 'business_members', 'staff_members',
        'beauty_services', 'staff_services', 'staff_schedules',
        'time_blocks', 'customers', 'appointments',
        'appointment_services', 'appointment_events'
      ])
      and c.relrowsecurity
      and c.relforcerowsecurity
  ),
  'policies', (
    select count(*) from pg_catalog.pg_policies where schemaname = 'public'
  ),
  'functions', (
    select json_agg(p.proname order by p.proname)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  ),
  'anon_table_grants', (
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name = any(array[
        'beauty_businesses', 'business_members', 'staff_members',
        'beauty_services', 'staff_services', 'staff_schedules',
        'time_blocks', 'customers', 'appointments',
        'appointment_services', 'appointment_events'
      ])
  ),
  'public_sensitive_execute', (
    select count(*)
    from information_schema.routine_privileges
    where grantee = 'PUBLIC'
      and routine_schema = 'public'
      and routine_name = any(array[
        'get_service_availability',
        'create_appointment_with_services',
        'bootstrap_beauty_business_owner'
      ])
  ),
  'authenticated_bootstrap_execute', (
    select has_function_privilege(
      'authenticated',
      'public.bootstrap_beauty_business_owner(uuid,text,text,text,character varying,character varying)',
      'EXECUTE'
    )
  ),
  'anon_availability_execute', (
    select has_function_privilege(
      'anon',
      'public.get_service_availability(uuid,uuid,date,uuid,time without time zone,time without time zone,integer)',
      'EXECUTE'
    )
  ),
  'anon_creation_execute', (
    select has_function_privilege(
      'anon',
      'public.create_appointment_with_services(uuid,uuid,timestamp with time zone,uuid,public.beauty_appointment_status,public.beauty_appointment_source,text,text,jsonb)',
      'EXECUTE'
    )
  ),
  'unsafe_definers', (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  ),
  'legacy_objects', (
    select count(*)
    from (
      select tablename as name
      from pg_catalog.pg_tables
      where schemaname = 'public'
      union all
      select p.proname
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    ) objects
    where lower(name) ~ '(restaurant|reservation|balinese|show|hospitality)'
  )
) as verification;
