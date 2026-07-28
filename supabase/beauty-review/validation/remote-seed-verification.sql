-- Read-only verification of the permanent fictitious development seed.

select json_build_object(
  'businesses', (
    select count(*) from public.beauty_businesses
    where id = '10000000-0000-0000-0000-000000000001'
      and name = 'Luna Beauty Studio'
  ),
  'staff_members', (
    select count(*) from public.staff_members
    where business_id = '10000000-0000-0000-0000-000000000001'
  ),
  'services', (
    select count(*) from public.beauty_services
    where business_id = '10000000-0000-0000-0000-000000000001'
  ),
  'customers', (
    select count(*) from public.customers
    where business_id = '10000000-0000-0000-0000-000000000001'
  ),
  'schedules', (
    select count(*) from public.staff_schedules
    where business_id = '10000000-0000-0000-0000-000000000001'
  ),
  'time_blocks', (
    select count(*) from public.time_blocks
    where business_id = '10000000-0000-0000-0000-000000000001'
  ),
  'appointments', (
    select count(*) from public.appointments
    where business_id = '10000000-0000-0000-0000-000000000001'
  ),
  'appointment_services', (
    select count(*) from public.appointment_services
    where business_id = '10000000-0000-0000-0000-000000000001'
  ),
  'appointment_events', (
    select count(*) from public.appointment_events
    where business_id = '10000000-0000-0000-0000-000000000001'
  ),
  'business_members', (
    select count(*) from public.business_members
    where business_id = '10000000-0000-0000-0000-000000000001'
  ),
  'transient_test_users', (
    select count(*) from auth.users
    where id in (
      '99000000-0000-0000-0000-000000000001',
      '99000000-0000-0000-0000-000000000002'
    )
  ),
  'transient_test_businesses', (
    select count(*) from public.beauty_businesses
    where id = '91000000-0000-0000-0000-000000000001'
       or slug = 'bootstrap-test-beauty'
  ),
  'transient_test_appointments', (
    select count(*) from public.appointments
    where id in (
      '96000000-0000-0000-0000-000000000001',
      '96000000-0000-0000-0000-000000000002'
    )
  )
) as seed_verification;
