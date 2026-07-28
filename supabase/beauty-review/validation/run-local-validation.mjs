import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '../.validation-runtime/node_modules/@electric-sql/pglite/dist/index.js';

const validationDir = path.dirname(fileURLToPath(import.meta.url));
const reviewDir = path.dirname(validationDir);
const migrationsDir = path.join(reviewDir, 'migrations');
const db = new PGlite();

const ids = {
  business: '10000000-0000-0000-0000-000000000001',
  secondBusiness: null,
  staff: '20000000-0000-0000-0000-000000000001',
  secondStaff: '20000000-0000-0000-0000-000000000002',
  thirdStaff: '20000000-0000-0000-0000-000000000003',
  service30: '30000000-0000-0000-0000-000000000002',
  service60: '30000000-0000-0000-0000-000000000005',
  customer: '40000000-0000-0000-0000-000000000001',
  owner: '90000000-0000-0000-0000-000000000001',
  admin: '90000000-0000-0000-0000-000000000002',
  staffUser: '90000000-0000-0000-0000-000000000003',
  outsider: '90000000-0000-0000-0000-000000000004',
  secondOwner: '90000000-0000-0000-0000-000000000005',
};

const results = [];
const migrationResults = [];

function record(area, test, passed, detail = '') {
  results.push({ area, test, passed, detail });
  if (!passed) {
    throw new Error(`[${area}] ${test}: ${detail}`);
  }
}

async function scalar(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0] ? Object.values(result.rows[0])[0] : undefined;
}

async function expectError(area, test, action, expectedPattern) {
  try {
    await action();
    record(area, test, false, 'Expected an error but the statement succeeded');
  } catch (error) {
    const message = String(error?.message ?? error);
    if (expectedPattern && !expectedPattern.test(message)) {
      record(area, test, false, `Unexpected error: ${message}`);
    }
    results.push({ area, test, passed: true, detail: message.split('\n')[0] });
  }
}

async function resetIdentity() {
  await db.exec(`
    reset role;
    select set_config('request.jwt.claim.sub', '', false);
  `);
}

async function asUser(userId, action) {
  await resetIdentity();
  await db.query(
    `select set_config('request.jwt.claim.sub', $1, false)`,
    [userId],
  );
  await db.exec('set role authenticated;');
  try {
    return await action();
  } finally {
    await resetIdentity();
  }
}

async function prepareSupabaseAuthStub() {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text unique,
      created_at timestamptz not null default now()
    );
    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    set search_path = pg_catalog, auth
    as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
}

async function applyMigrations() {
  const names = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();

  for (const name of names) {
    const sql = await fs.readFile(path.join(migrationsDir, name), 'utf8');
    try {
      await db.exec(sql);
      migrationResults.push({ name, passed: true });
    } catch (error) {
      migrationResults.push({
        name,
        passed: false,
        error: String(error?.message ?? error),
      });
      throw error;
    }
  }
}

async function insertUsersAndBootstrap() {
  await db.query(
    `insert into auth.users (id, email)
     select *
     from unnest($1::uuid[], $2::text[])`,
    [
      [ids.owner, ids.admin, ids.staffUser, ids.outsider, ids.secondOwner],
      [
        'owner@example.test',
        'admin@example.test',
        'staff@example.test',
        'outsider@example.test',
        'second-owner@example.test',
      ],
    ],
  );

  await expectError(
    'bootstrap',
    'Rejects a missing auth.user',
    () => db.query(
      `select public.bootstrap_beauty_business_owner(
        '99999999-0000-0000-0000-000000000999',
        'Missing owner', 'missing-owner'
      )`,
    ),
    /does not exist/i,
  );

  const bootstrapBusiness = await scalar(
    `select public.bootstrap_beauty_business_owner(
      $1, 'Luna Beauty Studio', 'luna-beauty-studio',
      'Europe/Madrid', 'EUR', 'es'
    )`,
    [ids.owner],
  );
  record(
    'bootstrap',
    'Associates an existing auth.user as owner',
    bootstrapBusiness === ids.business,
    String(bootstrapBusiness),
  );

  const repeatedBusiness = await scalar(
    `select public.bootstrap_beauty_business_owner(
      $1, 'Luna Beauty Studio', 'luna-beauty-studio',
      'Europe/Madrid', 'EUR', 'es'
    )`,
    [ids.owner],
  );
  const lunaCount = Number(await scalar(
    `select count(*) from public.beauty_businesses
     where slug = 'luna-beauty-studio'`,
  ));
  record(
    'bootstrap',
    'Repeated bootstrap is idempotent and creates no duplicate',
    repeatedBusiness === ids.business && lunaCount === 1,
    `businesses=${lunaCount}`,
  );

  await expectError(
    'bootstrap',
    'Rejects the same slug for a different owner',
    () => db.query(
      `select public.bootstrap_beauty_business_owner(
        $1, 'Other Luna', 'luna-beauty-studio',
        'Europe/Madrid', 'EUR', 'es'
      )`,
      [ids.secondOwner],
    ),
    /another owner/i,
  );

  const secondBusiness = await scalar(
    `select public.bootstrap_beauty_business_owner(
      $1, 'Second Beauty', 'second-beauty',
      'Europe/Madrid', 'EUR', 'es'
    )`,
    [ids.secondOwner],
  );
  ids.secondBusiness = secondBusiness;
  record(
    'bootstrap',
    'Creates an isolated second business',
    Boolean(secondBusiness) && secondBusiness !== ids.business,
    String(secondBusiness),
  );
}

async function applySeed() {
  const seed = await fs.readFile(path.join(reviewDir, 'seed_dev.sql'), 'utf8');
  await db.exec(seed);
  await db.exec(seed);

  const counts = await db.query(`
    select
      (select count(*) from public.beauty_businesses
       where id = '${ids.business}')::int as businesses,
      (select count(*) from public.staff_members
       where business_id = '${ids.business}')::int as staff,
      (select count(*) from public.beauty_services
       where business_id = '${ids.business}')::int as services,
      (select count(*) from public.customers
       where business_id = '${ids.business}')::int as customers,
      (select count(*) from public.appointments
       where business_id = '${ids.business}')::int as appointments;
  `);
  const count = counts.rows[0];
  record(
    'seed',
    'Seed is repeatable and preserves exact requested counts',
    count.businesses === 1
      && count.staff === 3
      && count.services === 8
      && count.customers === 10
      && count.appointments === 12,
    JSON.stringify(count),
  );

}

async function addMemberships() {
  await db.query(
    `insert into public.business_members
      (business_id, user_id, role, active)
     values
      ($1, $2, 'admin', true),
      ($1, $3, 'staff', true)`,
    [ids.business, ids.admin, ids.staffUser],
  );
  await db.query(
    `update public.staff_members
     set user_id = $1
     where id = $2 and business_id = $3`,
    [ids.staffUser, ids.staff, ids.business],
  );
}

async function validateSchema() {
  const version = await scalar('select version()');
  results.push({
    area: 'runtime',
    test: 'PostgreSQL runtime',
    passed: true,
    detail: String(version),
  });

  const tableCount = Number(await scalar(`
    select count(*)
    from information_schema.tables
    where table_schema = 'public'
      and table_name = any(array[
        'beauty_businesses', 'business_members', 'staff_members',
        'beauty_services', 'staff_services', 'staff_schedules',
        'time_blocks', 'customers', 'appointments',
        'appointment_services', 'appointment_events'
      ])
  `));
  record('schema', 'Creates all 11 Beauty tables', tableCount === 11, `count=${tableCount}`);

  const compositeFkCount = Number(await scalar(`
    select count(*)
    from pg_catalog.pg_constraint
    where contype = 'f'
      and connamespace = 'public'::regnamespace
      and array_length(conkey, 1) = 2
  `));
  record(
    'schema',
    'Creates composite tenant foreign keys',
    compositeFkCount >= 9,
    `count=${compositeFkCount}`,
  );

  await expectError(
    'schema',
    'Enum rejects an undefined appointment status',
    () => db.exec(`select 'invented'::public.beauty_appointment_status;`),
    /invalid input value/i,
  );
  await expectError(
    'schema',
    'Duration check rejects zero',
    () => db.exec(`
      insert into public.beauty_services (
        business_id, name, duration_minutes, price, currency
      ) values (
        '${ids.business}', 'Invalid duration', 0, 10, 'EUR'
      );
    `),
    /check constraint/i,
  );
  await expectError(
    'schema',
    'Price check rejects negative values',
    () => db.exec(`
      insert into public.beauty_services (
        business_id, name, duration_minutes, price, currency
      ) values (
        '${ids.business}', 'Invalid price', 30, -1, 'EUR'
      );
    `),
    /check constraint/i,
  );
  await expectError(
    'schema',
    'Composite FK rejects a professional from another business',
    () => db.exec(`
      insert into public.staff_services (
        business_id, staff_member_id, service_id
      ) values (
        '${ids.secondBusiness}', '${ids.staff}', '${ids.service30}'
      );
    `),
    /foreign key constraint/i,
  );

  await db.exec(`
    update public.beauty_services
    set updated_at = '2000-01-01T00:00:00Z'
    where id = '${ids.service30}';
    update public.beauty_services
    set description = 'Trigger validation'
    where id = '${ids.service30}';
  `);
  const updatedAtWorks = Boolean(await scalar(`
    select updated_at > '2000-01-02T00:00:00Z'::timestamptz
    from public.beauty_services where id = '${ids.service30}'
  `));
  record('schema', 'updated_at trigger advances timestamp', updatedAtWorks);

  const rlsCount = Number(await scalar(`
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
  `));
  record('schema', 'RLS is enabled and forced on every table', rlsCount === 11, `count=${rlsCount}`);

  const anonTablePrivileges = Number(await scalar(`
    select count(*)
    from information_schema.role_table_grants
    where grantee = 'anon'
      and table_schema = 'public'
      and table_name like '%beauty%'
  `));
  record('schema', 'anon has no Beauty table grants', anonTablePrivileges === 0);

  const publicSensitiveExecute = Number(await scalar(`
    select count(*)
    from information_schema.routine_privileges
    where grantee = 'PUBLIC'
      and routine_schema = 'public'
      and routine_name = any(array[
        'get_service_availability',
        'create_appointment_with_services',
        'bootstrap_beauty_business_owner'
      ])
  `));
  record(
    'schema',
    'PUBLIC has no EXECUTE on sensitive functions',
    publicSensitiveExecute === 0,
    `count=${publicSensitiveExecute}`,
  );

  const unsafeDefiners = Number(await scalar(`
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
      )
  `));
  record(
    'schema',
    'Every Beauty SECURITY DEFINER fixes search_path',
    unsafeDefiners === 0,
    `unsafe=${unsafeDefiners}`,
  );

  const authenticatedBootstrap = Boolean(await scalar(`
    select has_function_privilege(
      'authenticated',
      'public.bootstrap_beauty_business_owner(uuid,text,text,text,character varying,character varying)',
      'EXECUTE'
    )
  `));
  const anonAvailability = Boolean(await scalar(`
    select has_function_privilege(
      'anon',
      'public.get_service_availability(uuid,uuid,date,uuid,time without time zone,time without time zone,integer)',
      'EXECUTE'
    )
  `));
  const anonCreation = Boolean(await scalar(`
    select has_function_privilege(
      'anon',
      'public.create_appointment_with_services(uuid,uuid,timestamp with time zone,uuid,public.beauty_appointment_status,public.beauty_appointment_source,text,text,jsonb)',
      'EXECUTE'
    )
  `));
  record(
    'schema',
    'Bootstrap is closed to authenticated and internal RPCs are closed to anon',
    !authenticatedBootstrap && !anonAvailability && !anonCreation,
    JSON.stringify({
      authenticatedBootstrap,
      anonAvailability,
      anonCreation,
    }),
  );

  const helperUserIdArguments = Number(await scalar(`
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'is_business_member',
        'has_business_role',
        'current_staff_member_id',
        'can_access_beauty_appointment'
      ])
      and pg_get_function_arguments(p.oid) ilike '%user_id%'
  `));
  record(
    'schema',
    'Authorization helpers accept no client-controlled user_id',
    helperUserIdArguments === 0,
  );
}

async function validateRls() {
  const ownerBusinesses = Number(await asUser(ids.owner, () => scalar(
    `select count(*) from public.beauty_businesses`,
  )));
  record('rls', 'Owner reads its business only', ownerBusinesses === 1, `count=${ownerBusinesses}`);

  await asUser(ids.owner, () => db.query(
    `update public.beauty_businesses
     set phone = '+34919999999' where id = $1`,
    [ids.business],
  ));
  record('rls', 'Owner manages its business', true);

  await asUser(ids.admin, () => db.exec(`
    insert into public.beauty_services (
      business_id, name, duration_minutes, price, currency, active
    ) values (
      '${ids.business}', 'Admin temporary service', 30, 10, 'EUR', false
    );
  `));
  record('rls', 'Admin manages allowed operational catalogue', true);

  const adminSensitiveUpdate = await asUser(ids.admin, () => db.query(
    `update public.beauty_businesses
     set active = false
     where id = $1
     returning id`,
    [ids.business],
  ));
  const businessStillActive = Boolean(await scalar(
    `select active from public.beauty_businesses where id = $1`,
    [ids.business],
  ));
  record(
    'rls',
    'Admin cannot modify sensitive business settings directly',
    adminSensitiveUpdate.rows.length === 0 && businessStillActive,
    `updated_rows=${adminSensitiveUpdate.rows.length}`,
  );

  const staffBusinesses = Number(await asUser(ids.staffUser, () => scalar(
    `select count(*) from public.beauty_businesses`,
  )));
  const staffCustomers = Number(await asUser(ids.staffUser, () => scalar(
    `select count(*) from public.customers`,
  )));
  record(
    'rls',
    'Staff reads its business and only customers linked to its appointments',
    staffBusinesses === 1 && staffCustomers > 0 && staffCustomers < 10,
    `businesses=${staffBusinesses}, customers=${staffCustomers}`,
  );

  await expectError(
    'rls',
    'Staff cannot use a generic appointment UPDATE',
    () => asUser(ids.staffUser, () => db.exec(`
      update public.appointments
      set total_price = 0,
          business_id = '${ids.secondBusiness}',
          customer_id = '${ids.customer}',
          assigned_staff_member_id = '${ids.secondStaff}'
      where assigned_staff_member_id = '${ids.staff}';
    `)),
    /permission denied/i,
  );

  await expectError(
    'rls',
    'Direct appointment INSERT is blocked',
    () => asUser(ids.owner, () => db.exec(`
      insert into public.appointments (
        business_id, customer_id, starts_at, ends_at, status, source,
        total_duration_minutes, total_price, currency,
        assigned_staff_member_id
      ) values (
        '${ids.business}', '${ids.customer}', now(), now() + interval '30 min',
        'confirmed', 'manager', 30, 1, 'EUR', '${ids.staff}'
      );
    `)),
    /permission denied/i,
  );

  const outsiderBusinesses = Number(await asUser(ids.outsider, () => scalar(
    `select count(*) from public.beauty_businesses`,
  )));
  record('rls', 'External user reads no business data', outsiderBusinesses === 0);

  const secondOwnerLuna = Number(await asUser(ids.secondOwner, () => scalar(
    `select count(*) from public.beauty_businesses
     where id = '${ids.business}'`,
  )));
  record('rls', 'Business B cannot read business A', secondOwnerLuna === 0);

  const memberRows = Number(await asUser(ids.owner, () => scalar(
    `select count(*) from public.business_members`,
  )));
  record(
    'rls',
    'business_members policies do not recurse',
    memberRows === 3,
    `rows=${memberRows}`,
  );
}

async function prepareAvailabilityFixtures() {
  await db.exec(`
    delete from public.time_blocks
    where starts_at >= '2030-01-07T00:00:00Z'
      and starts_at < '2030-01-09T00:00:00Z';
    delete from public.appointment_events
    where appointment_id in (
      select id from public.appointments
      where starts_at >= '2030-01-07T00:00:00Z'
        and starts_at < '2030-01-09T00:00:00Z'
    );
    delete from public.appointment_services
    where appointment_id in (
      select id from public.appointments
      where starts_at >= '2030-01-07T00:00:00Z'
        and starts_at < '2030-01-09T00:00:00Z'
    );
    delete from public.appointments
    where starts_at >= '2030-01-07T00:00:00Z'
      and starts_at < '2030-01-09T00:00:00Z';

    insert into public.appointments (
      id, business_id, customer_id, starts_at, ends_at, status, source,
      total_duration_minutes, total_price, currency, assigned_staff_member_id,
      cancelled_at, cancellation_reason
    ) values
      (
        '61000000-0000-0000-0000-000000000001',
        '${ids.business}', '${ids.customer}',
        '2030-01-07 10:00 Europe/Madrid',
        '2030-01-07 10:30 Europe/Madrid',
        'confirmed', 'manager', 30, 20, 'EUR', '${ids.staff}',
        null, null
      ),
      (
        '61000000-0000-0000-0000-000000000002',
        '${ids.business}', '${ids.customer}',
        '2030-01-07 11:00 Europe/Madrid',
        '2030-01-07 11:30 Europe/Madrid',
        'cancelled', 'manager', 30, 20, 'EUR', '${ids.staff}',
        now(), 'Fictitious cancellation'
      );

    insert into public.appointment_services (
      id, business_id, appointment_id, service_id, staff_member_id,
      position, duration_minutes, price, starts_at, ends_at
    ) values
      (
        '71000000-0000-0000-0000-000000000001',
        '${ids.business}', '61000000-0000-0000-0000-000000000001',
        '${ids.service30}', '${ids.staff}', 1, 30, 20,
        '2030-01-07 10:00 Europe/Madrid',
        '2030-01-07 10:30 Europe/Madrid'
      ),
      (
        '71000000-0000-0000-0000-000000000002',
        '${ids.business}', '61000000-0000-0000-0000-000000000002',
        '${ids.service30}', '${ids.staff}', 1, 30, 20,
        '2030-01-07 11:00 Europe/Madrid',
        '2030-01-07 11:30 Europe/Madrid'
      );

    insert into public.time_blocks (
      id, business_id, staff_member_id, starts_at, ends_at,
      block_type, reason
    ) values
      (
        '51000000-0000-0000-0000-000000000001',
        '${ids.business}', '${ids.staff}',
        '2030-01-07 12:00 Europe/Madrid',
        '2030-01-07 12:30 Europe/Madrid',
        'break', 'Availability fixture'
      ),
      (
        '51000000-0000-0000-0000-000000000002',
        '${ids.business}', null,
        '2030-01-07 16:00 Europe/Madrid',
        '2030-01-07 17:00 Europe/Madrid',
        'business_closed', 'Global fixture'
      );

    update public.staff_services
    set active = false
    where business_id = '${ids.business}'
      and staff_member_id = '${ids.thirdStaff}'
      and service_id = '${ids.service30}';
  `);
}

async function availabilityRows(userId, overrides = {}) {
  const params = {
    business: ids.business,
    service: ids.service30,
    date: '2030-01-07',
    staff: ids.staff,
    from: null,
    to: null,
    interval: 15,
    ...overrides,
  };
  return asUser(userId, () => db.query(
    `select *
     from public.get_service_availability(
       $1, $2, $3::date, $4, $5::time, $6::time, $7
     )`,
    [
      params.business,
      params.service,
      params.date,
      params.staff,
      params.from,
      params.to,
      params.interval,
    ],
  ));
}

async function validateAvailability() {
  await prepareAvailabilityFixtures();
  const query = await availabilityRows(ids.owner);
  const rows = query.rows;
  const localMinute = (row) => {
    const date = new Date(row.starts_at);
    return date.getUTCHours() * 60 + date.getUTCMinutes() + 60;
  };
  const starts = rows.map(localMinute);
  const incrementsValid = starts
    .slice(1)
    .every((value, index) => {
      const difference = value - starts[index];
      return difference === 15 || difference > 60;
    });
  record('availability', 'Generates 15-minute slots', incrementsValid && rows.length > 0);
  record(
    'availability',
    'Keeps slots inside split schedule segments',
    starts.every((minute) => (
      (minute >= 9 * 60 && minute <= 13 * 60 + 30)
      || (minute >= 16 * 60 && minute <= 19 * 60 + 30)
    )),
  );

  const byLocalTime = new Map(rows.map((row) => [localMinute(row), row.available]));
  record(
    'availability',
    'Active appointment and its trailing buffer block slots',
    byLocalTime.get(10 * 60) === false
      && byLocalTime.get(10 * 60 + 30) === false
      && byLocalTime.get(10 * 60 + 45) === true,
    JSON.stringify({
      at1000: byLocalTime.get(600),
      at1030: byLocalTime.get(630),
      at1045: byLocalTime.get(645),
    }),
  );
  record(
    'availability',
    'Cancelled appointment does not block',
    byLocalTime.get(11 * 60) === true,
  );
  record(
    'availability',
    'Individual block is respected',
    byLocalTime.get(12 * 60) === false,
  );
  record(
    'availability',
    'Global closure is respected',
    byLocalTime.get(16 * 60) === false,
  );

  const filtered = await availabilityRows(ids.owner, {
    from: '17:00',
    to: '18:00',
  });
  record(
    'availability',
    'Professional and time-range filters work',
    filtered.rows.length > 0
      && filtered.rows.every((row) => {
        const minute = localMinute(row);
        return row.staff_member_id === ids.staff
          && minute >= 17 * 60
          && minute <= 18 * 60;
      }),
  );

  const disabled = await availabilityRows(ids.owner, { staff: ids.thirdStaff });
  record(
    'availability',
    'Professional not enabled for service returns no candidates',
    disabled.rows.length === 0,
  );

  const noSchedule = await availabilityRows(ids.owner, { date: '2030-01-06' });
  record('availability', 'Day without schedule returns no candidates', noSchedule.rows.length === 0);

  const firstStart = rows[0]?.starts_at;
  record(
    'availability',
    'Business timezone is converted to UTC',
    new Date(firstStart).toISOString().startsWith('2030-01-07T08:00:00'),
    String(firstStart),
  );

  await expectError(
    'availability',
    'External user cannot query internal availability',
    () => availabilityRows(ids.outsider),
    /not authorized/i,
  );
  await expectError(
    'availability',
    'Rejects unreasonable slot interval',
    () => availabilityRows(ids.owner, { interval: 1 }),
    /between 5 and 120/i,
  );
}

async function createAppointment(userId, overrides = {}) {
  const values = {
    business: ids.business,
    customer: ids.customer,
    start: '2030-01-07T17:15:00+01:00',
    staff: ids.staff,
    status: 'confirmed',
    source: 'manager',
    customerNotes: 'Fictitious local test',
    internalNotes: 'Local validation only',
    services: [
      { service_id: ids.service30, price: 0, duration_minutes: 1 },
      { service_id: '30000000-0000-0000-0000-000000000008', price: 0 },
    ],
    ...overrides,
  };
  return asUser(userId, () => db.query(
    `select *
     from public.create_appointment_with_services(
       $1, $2, $3::timestamptz, $4,
       $5::public.beauty_appointment_status,
       $6::public.beauty_appointment_source,
       $7, $8, $9::jsonb
     )`,
    [
      values.business,
      values.customer,
      values.start,
      values.staff,
      values.status,
      values.source,
      values.customerNotes,
      values.internalNotes,
      JSON.stringify(values.services),
    ],
  ));
}

async function validateAppointmentCreation() {
  const created = await createAppointment(ids.owner);
  const appointment = created.rows[0];
  record('appointment', 'Creates a valid appointment', Boolean(appointment?.id));
  record(
    'appointment',
    'Recalculates duration and price from catalogue',
    appointment.total_duration_minutes === 60
      && Number(appointment.total_price) === 38,
    `duration=${appointment.total_duration_minutes}, price=${appointment.total_price}`,
  );

  const serviceRows = await db.query(
    `select * from public.appointment_services
     where appointment_id = $1 order by position`,
    [appointment.id],
  );
  record(
    'appointment',
    'Creates ordered appointment_services for one professional',
    serviceRows.rows.length === 2
      && serviceRows.rows.every((row) => row.staff_member_id === ids.staff),
    `rows=${serviceRows.rows.length}`,
  );
  const eventCount = Number(await scalar(
    `select count(*) from public.appointment_events
     where appointment_id = $1 and event_type = 'created'`,
    [appointment.id],
  ));
  record('appointment', 'Creates the event created', eventCount === 1);

  await expectError(
    'appointment',
    'Rejects an occupied slot',
    () => createAppointment(ids.owner),
    /not available|conflict/i,
  );
  await expectError(
    'appointment',
    'Rejects outside working hours',
    () => createAppointment(ids.owner, {
      start: '2030-01-07T21:00:00+01:00',
      services: [{ service_id: ids.service30 }],
    }),
    /not available|schedule/i,
  );
  await expectError(
    'appointment',
    'Rejects during a time block',
    () => createAppointment(ids.owner, {
      start: '2030-01-07T12:00:00+01:00',
      services: [{ service_id: ids.service30 }],
    }),
    /not available|conflict/i,
  );
  await expectError(
    'appointment',
    'Rejects a professional not enabled for a service',
    () => createAppointment(ids.owner, {
      start: '2030-01-07T18:30:00+01:00',
      staff: ids.thirdStaff,
      services: [{ service_id: ids.service30 }],
    }),
    /invalid or not enabled/i,
  );
  await expectError(
    'appointment',
    'Rejects arbitrary initial status',
    () => createAppointment(ids.owner, {
      start: '2030-01-07T18:30:00+01:00',
      status: 'completed',
      services: [{ service_id: ids.service30 }],
    }),
    /pending or confirmed/i,
  );

  const secondCustomer = await scalar(`
    insert into public.customers (
      business_id, first_name, phone, phone_normalized
    ) values (
      '${ids.secondBusiness}', 'Other', '+34619999999', '+34619999999'
    ) returning id
  `);
  await expectError(
    'appointment',
    'Rejects a customer from another business',
    () => createAppointment(ids.owner, {
      start: '2030-01-07T18:30:00+01:00',
      customer: secondCustomer,
      services: [{ service_id: ids.service30 }],
    }),
    /customer not found/i,
  );

  const secondService = await scalar(`
    insert into public.beauty_services (
      business_id, name, duration_minutes, price, currency
    ) values (
      '${ids.secondBusiness}', 'Other service', 30, 10, 'EUR'
    ) returning id
  `);
  await expectError(
    'appointment',
    'Rejects a service from another business and rolls back fully',
    () => createAppointment(ids.owner, {
      start: '2030-01-07T18:30:00+01:00',
      services: [
        { service_id: ids.service30 },
        { service_id: secondService },
      ],
    }),
    /invalid or not enabled/i,
  );
  const failedStartCount = Number(await scalar(`
    select count(*) from public.appointments
    where business_id = '${ids.business}'
      and starts_at = '2030-01-07T17:30:00Z'::timestamptz
  `));
  record(
    'appointment',
    'Failed multi-service operation leaves no appointment',
    failedStartCount === 0,
  );

  const orphanServices = Number(await scalar(`
    select count(*)
    from public.appointment_services aps
    left join public.appointments a
      on a.id = aps.appointment_id and a.business_id = aps.business_id
    where a.id is null
  `));
  const orphanEvents = Number(await scalar(`
    select count(*)
    from public.appointment_events ae
    left join public.appointments a
      on a.id = ae.appointment_id and a.business_id = ae.business_id
    where a.id is null
  `));
  record(
    'appointment',
    'No orphan services or events remain',
    orphanServices === 0 && orphanEvents === 0,
    `services=${orphanServices}, events=${orphanEvents}`,
  );

  const functionDefinition = await scalar(`
    select pg_get_functiondef(p.oid)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'create_appointment_with_services'
  `);
  record(
    'appointment',
    'Advisory lock key includes business, professional and local date',
    /pg_advisory_xact_lock/.test(functionDefinition)
      && /p_business_id/.test(functionDefinition)
      && /p_assigned_staff_member_id/.test(functionDefinition)
      && /v_local_date/.test(functionDefinition),
  );
}

async function validateConcurrencyLimitation() {
  results.push({
    area: 'concurrency',
    test: 'Two independent simultaneous PostgreSQL sessions',
    passed: null,
    skipped: true,
    detail: 'NOT_EXECUTED: PGlite in-memory exposes one session; real concurrent advisory-lock behavior requires native PostgreSQL.',
  });
}

async function main() {
  try {
    await db.waitReady;
    await prepareSupabaseAuthStub();
    await applyMigrations();
    await applySeed();
    await insertUsersAndBootstrap();
    await addMemberships();
    await validateSchema();
    await validateRls();
    await validateAvailability();
    await validateAppointmentCreation();
    await validateConcurrencyLimitation();

    const summary = {
      passed: results.filter((result) => result.passed === true).length,
      failed: results.filter((result) => result.passed === false).length,
      skipped: results.filter((result) => result.skipped).length,
      migrations: migrationResults,
      results,
    };
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      fatal: String(error?.message ?? error),
      migrations: migrationResults,
      results,
      stack: error?.stack,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

await main();
