-- Remote integration tests for the isolated COSTABOTS Beauty project.
-- Every user and fixture created here is fictitious and rolled back.

begin;

create temporary table beauty_remote_test_context (
  test_date date not null
) on commit drop;

insert into beauty_remote_test_context (test_date)
values (
  current_date
  + case
      when extract(isodow from current_date)::integer = 1 then 7
      else 8 - extract(isodow from current_date)::integer
    end
);

grant select on beauty_remote_test_context to authenticated;

insert into auth.users (
  id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  (
    '99000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'remote-owner@beauty-validation.example',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '99000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'remote-external@beauty-validation.example',
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

do $$
declare
  bootstrap_business_id uuid;
  rejected boolean := false;
begin
  select public.bootstrap_beauty_business_owner(
    '99000000-0000-0000-0000-000000000001',
    'Bootstrap Test Beauty',
    'bootstrap-test-beauty',
    'Europe/Madrid',
    'EUR',
    'es'
  )
  into bootstrap_business_id;

  if bootstrap_business_id is null or not exists (
    select 1
    from public.business_members
    where business_id = bootstrap_business_id
      and user_id = '99000000-0000-0000-0000-000000000001'
      and role = 'owner'
      and active
  ) then
    raise exception 'Bootstrap did not create the business owner';
  end if;

  begin
    perform public.bootstrap_beauty_business_owner(
      '99999999-0000-0000-0000-000000000999',
      'Missing Bootstrap User',
      'missing-bootstrap-user',
      'Europe/Madrid',
      'EUR',
      'es'
    );
  exception when no_data_found then
    rejected := true;
  end;

  if not rejected then
    raise exception 'Bootstrap accepted a missing auth.user';
  end if;
end;
$$;

insert into public.business_members (
  business_id, user_id, role, active
)
values (
  '10000000-0000-0000-0000-000000000001',
  '99000000-0000-0000-0000-000000000001',
  'owner',
  true
);

insert into public.beauty_businesses (
  id, name, slug, timezone, default_currency, default_language
)
values (
  '91000000-0000-0000-0000-000000000001',
  'Transactional Test Beauty',
  'transactional-test-beauty',
  'Europe/Madrid',
  'EUR',
  'es'
);

insert into public.customers (
  id, business_id, first_name, phone, phone_normalized
)
values (
  '94000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  'Cliente',
  '+34619999001',
  '+34619999001'
);

insert into public.beauty_services (
  id, business_id, name, duration_minutes, price, currency
)
values (
  '93000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  'Servicio de otro negocio',
  30,
  10,
  'EUR'
);

insert into public.appointments (
  id, business_id, customer_id, starts_at, ends_at, status, source,
  total_duration_minutes, total_price, currency, assigned_staff_member_id
)
select
  '96000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  (test_date + time '10:00') at time zone 'Europe/Madrid',
  (test_date + time '10:30') at time zone 'Europe/Madrid',
  'confirmed',
  'manager',
  30,
  20,
  'EUR',
  '20000000-0000-0000-0000-000000000001'
from beauty_remote_test_context;

insert into public.appointments (
  id, business_id, customer_id, starts_at, ends_at, status, source,
  total_duration_minutes, total_price, currency, assigned_staff_member_id,
  cancelled_at, cancellation_reason
)
select
  '96000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  (test_date + time '11:00') at time zone 'Europe/Madrid',
  (test_date + time '11:30') at time zone 'Europe/Madrid',
  'cancelled',
  'manager',
  30,
  20,
  'EUR',
  '20000000-0000-0000-0000-000000000001',
  now(),
  'Cancelación ficticia de prueba'
from beauty_remote_test_context;

insert into public.appointment_services (
  id, business_id, appointment_id, service_id, staff_member_id,
  position, duration_minutes, price, starts_at, ends_at
)
select
  '97000000-0000-0000-0000-000000000001'::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid,
  '96000000-0000-0000-0000-000000000001'::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  1,
  30,
  20,
  (test_date + time '10:00') at time zone 'Europe/Madrid',
  (test_date + time '10:30') at time zone 'Europe/Madrid'
from beauty_remote_test_context
union all
select
  '97000000-0000-0000-0000-000000000002'::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid,
  '96000000-0000-0000-0000-000000000002'::uuid,
  '30000000-0000-0000-0000-000000000002'::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  1,
  30,
  20,
  (test_date + time '11:00') at time zone 'Europe/Madrid',
  (test_date + time '11:30') at time zone 'Europe/Madrid'
from beauty_remote_test_context;

insert into public.time_blocks (
  id, business_id, staff_member_id, starts_at, ends_at,
  block_type, reason
)
select
  '95000000-0000-0000-0000-000000000001'::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid,
  '20000000-0000-0000-0000-000000000001'::uuid,
  (test_date + time '12:00') at time zone 'Europe/Madrid',
  (test_date + time '12:30') at time zone 'Europe/Madrid',
  'break'::public.beauty_time_block_type,
  'Bloqueo individual ficticio'
from beauty_remote_test_context
union all
select
  '95000000-0000-0000-0000-000000000002'::uuid,
  '10000000-0000-0000-0000-000000000001'::uuid,
  null::uuid,
  (test_date + time '16:00') at time zone 'Europe/Madrid',
  (test_date + time '17:00') at time zone 'Europe/Madrid',
  'business_closed'::public.beauty_time_block_type,
  'Cierre global ficticio'
from beauty_remote_test_context;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '99000000-0000-0000-0000-000000000002',
  true
);

do $$
declare
  visible_businesses integer;
  rejected boolean := false;
  target_date date;
begin
  select count(*) into visible_businesses
  from public.beauty_businesses;

  if visible_businesses <> 0 then
    raise exception 'External user unexpectedly sees Beauty businesses';
  end if;

  select test_date into target_date from beauty_remote_test_context;

  begin
    perform *
    from public.get_service_availability(
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      target_date,
      '20000000-0000-0000-0000-000000000001',
      null,
      null,
      15
    );
  exception when insufficient_privilege then
    rejected := true;
  end;

  if not rejected then
    raise exception 'External availability request was not rejected';
  end if;
end;
$$;

select set_config(
  'request.jwt.claim.sub',
  '99000000-0000-0000-0000-000000000001',
  true
);

do $$
declare
  target_date date;
  valid_appointment public.appointments;
  rejected boolean;
  appointment_count_before integer;
  appointment_count_after integer;
begin
  select test_date into target_date from beauty_remote_test_context;

  if not exists (
    select 1
    from public.get_service_availability(
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      target_date,
      '20000000-0000-0000-0000-000000000001',
      time '10:00',
      time '10:00',
      15
    )
    where available = false
  ) then
    raise exception 'Active appointment did not block its slot';
  end if;

  if not exists (
    select 1
    from public.get_service_availability(
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      target_date,
      '20000000-0000-0000-0000-000000000001',
      time '10:30',
      time '10:30',
      15
    )
    where available = false
  ) then
    raise exception 'Appointment trailing buffer did not block';
  end if;

  if not exists (
    select 1
    from public.get_service_availability(
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      target_date,
      '20000000-0000-0000-0000-000000000001',
      time '11:00',
      time '11:00',
      15
    )
    where available = true
  ) then
    raise exception 'Cancelled appointment unexpectedly blocked';
  end if;

  if not exists (
    select 1
    from public.get_service_availability(
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      target_date,
      '20000000-0000-0000-0000-000000000001',
      time '12:00',
      time '12:00',
      15
    )
    where available = false
  ) then
    raise exception 'Individual time block was ignored';
  end if;

  if not exists (
    select 1
    from public.get_service_availability(
      '10000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000002',
      target_date,
      '20000000-0000-0000-0000-000000000001',
      time '16:00',
      time '16:00',
      15
    )
    where available = false
  ) then
    raise exception 'Global closure was ignored';
  end if;

  select *
  into valid_appointment
  from public.create_appointment_with_services(
    '10000000-0000-0000-0000-000000000001',
    '40000000-0000-0000-0000-000000000001',
    (target_date + time '17:15') at time zone 'Europe/Madrid',
    '20000000-0000-0000-0000-000000000001',
    'confirmed',
    'manager',
    'Nota ficticia',
    'Validación remota transaccional',
    jsonb_build_array(
      jsonb_build_object(
        'service_id', '30000000-0000-0000-0000-000000000002',
        'price', 0,
        'duration_minutes', 1
      ),
      jsonb_build_object(
        'service_id', '30000000-0000-0000-0000-000000000008',
        'price', 0
      )
    )
  );

  if valid_appointment.total_duration_minutes <> 60
     or valid_appointment.total_price <> 38 then
    raise exception 'Server did not recalculate duration and price';
  end if;

  if (
    select count(*) from public.appointment_services
    where appointment_id = valid_appointment.id
      and staff_member_id = '20000000-0000-0000-0000-000000000001'
  ) <> 2 then
    raise exception 'Appointment services were not created for one professional';
  end if;

  if (
    select count(*) from public.appointment_events
    where appointment_id = valid_appointment.id
      and event_type = 'created'
  ) <> 1 then
    raise exception 'Created event was not written';
  end if;

  rejected := false;
  begin
    perform public.create_appointment_with_services(
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      valid_appointment.starts_at,
      '20000000-0000-0000-0000-000000000001',
      'confirmed',
      'manager',
      null,
      null,
      jsonb_build_array(jsonb_build_object(
        'service_id', '30000000-0000-0000-0000-000000000002'
      ))
    );
  exception when sqlstate '23P01' then
    rejected := true;
  end;

  if not rejected then
    raise exception 'Occupied slot was accepted';
  end if;

  select count(*) into appointment_count_before
  from public.appointments
  where business_id = '10000000-0000-0000-0000-000000000001';

  rejected := false;
  begin
    perform public.create_appointment_with_services(
      '10000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      (target_date + time '18:30') at time zone 'Europe/Madrid',
      '20000000-0000-0000-0000-000000000001',
      'confirmed',
      'manager',
      null,
      null,
      jsonb_build_array(
        jsonb_build_object(
          'service_id', '30000000-0000-0000-0000-000000000002'
        ),
        jsonb_build_object(
          'service_id', '93000000-0000-0000-0000-000000000001'
        )
      )
    );
  exception when invalid_parameter_value then
    rejected := true;
  end;

  select count(*) into appointment_count_after
  from public.appointments
  where business_id = '10000000-0000-0000-0000-000000000001';

  if not rejected or appointment_count_before <> appointment_count_after then
    raise exception 'Invalid multi-service request did not roll back';
  end if;
end;
$$;

reset role;

select json_build_object(
  'transactional_tests', 'passed',
  'persistent_test_users', 0,
  'persistent_test_fixtures', 0
) as remote_test_result;

rollback;
