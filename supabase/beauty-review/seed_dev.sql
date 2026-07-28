-- Fictional local development data for COSTABOTS Beauty.
-- No auth.users or business_members are created here.

begin;

insert into public.beauty_businesses (
  id, name, slug, timezone, phone, email, address,
  default_currency, default_language, active
) values (
  '10000000-0000-0000-0000-000000000001',
  'Luna Beauty Studio',
  'luna-beauty-studio',
  'Europe/Madrid',
  '+34910000000',
  'hola@luna-beauty.example',
  'Calle Ficticia 12, Madrid',
  'EUR',
  'es',
  true
)
on conflict (id) do nothing;

insert into public.staff_members (
  id, business_id, display_name, phone, email, color_key, sort_order
) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Laura Vega', '+34600000101', 'laura@luna-beauty.example', 'coral', 1),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Marta Sol', '+34600000102', 'marta@luna-beauty.example', 'sage', 2),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Álex Mar', '+34600000103', 'alex@luna-beauty.example', 'sand', 3)
on conflict (id) do nothing;

insert into public.beauty_services (
  id, business_id, name, description, duration_minutes,
  buffer_before_minutes, buffer_after_minutes, price, currency,
  online_booking_enabled, reactivation_days
) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Corte mujer', 'Corte y acabado básico', 45, 0, 10, 32.00, 'EUR', true, 42),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Corte hombre', 'Corte clásico', 30, 0, 5, 20.00, 'EUR', true, 30),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Color completo', 'Coloración completa', 120, 10, 15, 78.00, 'EUR', true, 42),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Mechas y peinado', 'Mechas con acabado', 150, 10, 15, 95.00, 'EUR', true, 56),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Manicura semipermanente', 'Manicura y esmaltado', 60, 5, 10, 29.00, 'EUR', true, 21),
  ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'Pedicura completa', 'Pedicura y esmaltado', 75, 5, 10, 39.00, 'EUR', true, 35),
  ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'Tratamiento hidratación', 'Tratamiento capilar hidratante', 45, 0, 10, 35.00, 'EUR', true, 30),
  ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'Diseño de cejas', 'Diseño y definición', 30, 0, 5, 18.00, 'EUR', true, 28)
on conflict (id) do nothing;

insert into public.staff_services (
  id, business_id, staff_member_id, service_id
)
select
  (
    substr(md5(sm.id::text || bs.id::text), 1, 8) || '-' ||
    substr(md5(sm.id::text || bs.id::text), 9, 4) || '-' ||
    substr(md5(sm.id::text || bs.id::text), 13, 4) || '-' ||
    substr(md5(sm.id::text || bs.id::text), 17, 4) || '-' ||
    substr(md5(sm.id::text || bs.id::text), 21, 12)
  )::uuid,
  sm.business_id,
  sm.id,
  bs.id
from public.staff_members sm
cross join public.beauty_services bs
where sm.business_id = '10000000-0000-0000-0000-000000000001'
  and bs.business_id = sm.business_id
on conflict (business_id, staff_member_id, service_id) do nothing;

insert into public.staff_schedules (
  id, business_id, staff_member_id, day_of_week, start_time, end_time
)
select
  (
    substr(md5(sm.id::text || d.day::text || d.start_time::text), 1, 8) || '-' ||
    substr(md5(sm.id::text || d.day::text || d.start_time::text), 9, 4) || '-' ||
    substr(md5(sm.id::text || d.day::text || d.start_time::text), 13, 4) || '-' ||
    substr(md5(sm.id::text || d.day::text || d.start_time::text), 17, 4) || '-' ||
    substr(md5(sm.id::text || d.day::text || d.start_time::text), 21, 12)
  )::uuid,
  sm.business_id,
  sm.id,
  d.day,
  d.start_time,
  d.end_time
from public.staff_members sm
cross join (
  values
    (1::smallint, '09:00'::time, '14:00'::time),
    (1::smallint, '16:00'::time, '20:00'::time),
    (2::smallint, '09:00'::time, '14:00'::time),
    (2::smallint, '16:00'::time, '20:00'::time),
    (3::smallint, '09:00'::time, '14:00'::time),
    (3::smallint, '16:00'::time, '20:00'::time),
    (4::smallint, '09:00'::time, '14:00'::time),
    (4::smallint, '16:00'::time, '20:00'::time),
    (5::smallint, '09:00'::time, '14:00'::time),
    (5::smallint, '16:00'::time, '20:00'::time),
    (6::smallint, '10:00'::time, '14:00'::time)
) as d(day, start_time, end_time)
where sm.business_id = '10000000-0000-0000-0000-000000000001'
on conflict (id) do nothing;

insert into public.customers (
  id, business_id, first_name, last_name, phone, phone_normalized,
  email, marketing_consent, reminder_consent
) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ana', 'García', '+34610000001', '+34610000001', 'ana.garcia@example.test', true, true),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'María', 'López', '+34610000002', '+34610000002', 'maria.lopez@example.test', false, true),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Paula', 'Gómez', '+34610000003', '+34610000003', 'paula.gomez@example.test', true, true),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'Carmen', 'Ruiz', '+34610000004', '+34610000004', 'carmen.ruiz@example.test', false, true),
  ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Elena', 'Sánchez', '+34610000005', '+34610000005', 'elena.sanchez@example.test', true, true),
  ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'Javier', 'Martín', '+34610000006', '+34610000006', 'javier.martin@example.test', false, true),
  ('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'Marta', 'Gómez', '+34610000007', '+34610000007', 'marta.gomez@example.test', true, true),
  ('40000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'Laura', 'Sánchez', '+34610000008', '+34610000008', 'laura.sanchez@example.test', false, true),
  ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'Cristina', 'Ruiz', '+34610000009', '+34610000009', 'cristina.ruiz@example.test', true, true),
  ('40000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'Paula', 'Martín', '+34610000010', '+34610000010', 'paula.martin@example.test', false, false)
on conflict (id) do nothing;

insert into public.time_blocks (
  id, business_id, staff_member_id, starts_at, ends_at, block_type, reason
) values
  (
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    (current_date + 1 + '13:30'::time) at time zone 'Europe/Madrid',
    (current_date + 1 + '14:00'::time) at time zone 'Europe/Madrid',
    'break',
    'Pausa ficticia'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002',
    (current_date + 3 + '09:00'::time) at time zone 'Europe/Madrid',
    (current_date + 3 + '14:00'::time) at time zone 'Europe/Madrid',
    'personal',
    'Asunto personal ficticio'
  ),
  (
    '50000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    null,
    (current_date + 7 + '09:00'::time) at time zone 'Europe/Madrid',
    (current_date + 7 + '20:00'::time) at time zone 'Europe/Madrid',
    'business_closed',
    'Cierre ficticio'
  )
on conflict (id) do nothing;

insert into public.appointments (
  id, business_id, customer_id, starts_at, ends_at, status, source,
  total_duration_minutes, total_price, currency, assigned_staff_member_id,
  cancelled_at, cancellation_reason
) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', (current_date + '09:00'::time) at time zone 'Europe/Madrid', (current_date + '10:00'::time) at time zone 'Europe/Madrid', 'confirmed', 'manager', 60, 29.00, 'EUR', '20000000-0000-0000-0000-000000000001', null, null),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', (current_date + '10:15'::time) at time zone 'Europe/Madrid', (current_date + '11:00'::time) at time zone 'Europe/Madrid', 'arrived', 'phone', 45, 32.00, 'EUR', '20000000-0000-0000-0000-000000000002', null, null),
  ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', (current_date + '11:15'::time) at time zone 'Europe/Madrid', (current_date + '12:00'::time) at time zone 'Europe/Madrid', 'in_service', 'walk_in', 45, 35.00, 'EUR', '20000000-0000-0000-0000-000000000003', null, null),
  ('60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', (current_date + '12:15'::time) at time zone 'Europe/Madrid', (current_date + '14:15'::time) at time zone 'Europe/Madrid', 'pending', 'manager', 120, 78.00, 'EUR', '20000000-0000-0000-0000-000000000001', null, null),
  ('60000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000005', (current_date + 1 + '09:00'::time) at time zone 'Europe/Madrid', (current_date + 1 + '11:30'::time) at time zone 'Europe/Madrid', 'confirmed', 'manager', 150, 95.00, 'EUR', '20000000-0000-0000-0000-000000000002', null, null),
  ('60000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000006', (current_date + 1 + '12:00'::time) at time zone 'Europe/Madrid', (current_date + 1 + '12:30'::time) at time zone 'Europe/Madrid', 'confirmed', 'phone', 30, 20.00, 'EUR', '20000000-0000-0000-0000-000000000003', null, null),
  ('60000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000007', (current_date - 1 + '09:00'::time) at time zone 'Europe/Madrid', (current_date - 1 + '09:30'::time) at time zone 'Europe/Madrid', 'completed', 'manager', 30, 18.00, 'EUR', '20000000-0000-0000-0000-000000000001', null, null),
  ('60000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000008', (current_date - 1 + '10:00'::time) at time zone 'Europe/Madrid', (current_date - 1 + '11:15'::time) at time zone 'Europe/Madrid', 'no_show', 'phone', 75, 39.00, 'EUR', '20000000-0000-0000-0000-000000000002', null, null),
  ('60000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000009', (current_date + 2 + '16:00'::time) at time zone 'Europe/Madrid', (current_date + 2 + '16:45'::time) at time zone 'Europe/Madrid', 'confirmed', 'manager', 45, 32.00, 'EUR', '20000000-0000-0000-0000-000000000003', null, null),
  ('60000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000010', (current_date + 2 + '17:00'::time) at time zone 'Europe/Madrid', (current_date + 2 + '18:00'::time) at time zone 'Europe/Madrid', 'pending', 'manager', 60, 29.00, 'EUR', '20000000-0000-0000-0000-000000000001', null, null),
  ('60000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000003', (current_date - 2 + '16:00'::time) at time zone 'Europe/Madrid', (current_date - 2 + '16:45'::time) at time zone 'Europe/Madrid', 'completed', 'walk_in', 45, 35.00, 'EUR', '20000000-0000-0000-0000-000000000002', null, null),
  ('60000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000004', (current_date - 3 + '17:00'::time) at time zone 'Europe/Madrid', (current_date - 3 + '17:30'::time) at time zone 'Europe/Madrid', 'cancelled', 'phone', 30, 20.00, 'EUR', '20000000-0000-0000-0000-000000000003', (current_date - 4 + '12:00'::time) at time zone 'Europe/Madrid', 'Cancelación ficticia')
on conflict (id) do nothing;

insert into public.appointment_services (
  id, business_id, appointment_id, service_id, staff_member_id,
  position, duration_minutes, price, starts_at, ends_at
)
select
  ('70000000-0000-0000-0000-' || right(a.id::text, 12))::uuid,
  a.business_id,
  a.id,
  mapping.service_id,
  a.assigned_staff_member_id,
  1,
  a.total_duration_minutes,
  a.total_price,
  a.starts_at,
  a.ends_at
from public.appointments a
join (
  values
    ('60000000-0000-0000-0000-000000000001'::uuid, '30000000-0000-0000-0000-000000000005'::uuid),
    ('60000000-0000-0000-0000-000000000002'::uuid, '30000000-0000-0000-0000-000000000001'::uuid),
    ('60000000-0000-0000-0000-000000000003'::uuid, '30000000-0000-0000-0000-000000000007'::uuid),
    ('60000000-0000-0000-0000-000000000004'::uuid, '30000000-0000-0000-0000-000000000003'::uuid),
    ('60000000-0000-0000-0000-000000000005'::uuid, '30000000-0000-0000-0000-000000000004'::uuid),
    ('60000000-0000-0000-0000-000000000006'::uuid, '30000000-0000-0000-0000-000000000002'::uuid),
    ('60000000-0000-0000-0000-000000000007'::uuid, '30000000-0000-0000-0000-000000000008'::uuid),
    ('60000000-0000-0000-0000-000000000008'::uuid, '30000000-0000-0000-0000-000000000006'::uuid),
    ('60000000-0000-0000-0000-000000000009'::uuid, '30000000-0000-0000-0000-000000000001'::uuid),
    ('60000000-0000-0000-0000-000000000010'::uuid, '30000000-0000-0000-0000-000000000005'::uuid),
    ('60000000-0000-0000-0000-000000000011'::uuid, '30000000-0000-0000-0000-000000000007'::uuid),
    ('60000000-0000-0000-0000-000000000012'::uuid, '30000000-0000-0000-0000-000000000002'::uuid)
) mapping(appointment_id, service_id) on mapping.appointment_id = a.id
where a.business_id = '10000000-0000-0000-0000-000000000001'
on conflict (appointment_id, position) do nothing;

insert into public.appointment_events (
  id, business_id, appointment_id, event_type, new_data, source
)
select
  ('80000000-0000-0000-0000-' || right(a.id::text, 12))::uuid,
  a.business_id,
  a.id,
  'created',
  jsonb_build_object(
    'status', a.status,
    'starts_at', a.starts_at,
    'ends_at', a.ends_at,
    'assigned_staff_member_id', a.assigned_staff_member_id,
    'service_count', 1
  ),
  a.source
from public.appointments a
where a.business_id = '10000000-0000-0000-0000-000000000001'
on conflict (id) do nothing;

commit;

