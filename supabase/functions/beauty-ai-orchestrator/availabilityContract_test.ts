import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { availabilityRowsToSlots, buildAvailabilityRpcArgs, normalizeAvailabilityDate } from './availabilityContract.ts';

const businessId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';

Deno.test('availability date is always YYYY-MM-DD', () => {
  assertEquals(normalizeAvailabilityDate('2026-08-03'), '2026-08-03');
  assertEquals(normalizeAvailabilityDate('2026-08-03T09:30:00.000Z'), '2026-08-03');
  assertEquals(normalizeAvailabilityDate(new Date('2026-08-03T09:30:00.000Z')), '2026-08-03');
  assertThrows(() => normalizeAvailabilityDate('03/08/2026'));
});

Deno.test('valid empty data is no availability and real rows become structured slots', () => {
  assertEquals(availabilityRowsToSlots([], 'Europe/Madrid'), []);
  const slots = availabilityRowsToSlots([{
    staff_member_id: staffId,
    staff_display_name: 'Profesional',
    starts_at: '2026-08-03T07:00:00.000Z',
    ends_at: '2026-08-03T07:30:00.000Z',
    available: true,
  }], 'Europe/Madrid');
  assertEquals(slots[0].label, '09:00');
  assertEquals(slots[0].staffId, staffId);
  assertEquals(slots[0].startsAt, '2026-08-03T07:00:00.000Z');
});

Deno.test('availability RPC omits absent staff and includes existing staff', () => {
  const withoutStaff = buildAvailabilityRpcArgs({ businessId, serviceId, date: '2026-08-03', staffId: null });
  assertEquals('p_staff_member_id' in withoutStaff, false);
  const withStaff = buildAvailabilityRpcArgs({ businessId, serviceId, date: '2026-08-03', staffId });
  assertEquals(withStaff.p_staff_member_id, staffId);
  assertEquals(withStaff.p_date, '2026-08-03');
});
