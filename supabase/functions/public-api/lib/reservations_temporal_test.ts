import { assertEquals } from 'jsr:@std/assert@1';
import { getAvailableHoursByCapacity } from './availability.ts';
import { isReservationTimeTooSoon, MIN_BOOKING_LEAD_MINUTES } from './reservations.ts';

const madrid = 'Europe/Madrid';

Deno.test('requires the configured 30-minute lead time in Madrid', () => {
  const now = new Date('2026-10-14T10:30:00.000Z'); // 12:30 in Madrid (CEST)
  assertEquals(MIN_BOOKING_LEAD_MINUTES, 30);
  assertEquals(isReservationTimeTooSoon('14/10/2026', '12:59', now, madrid), true);
  assertEquals(isReservationTimeTooSoon('14/10/2026', '13:00', now, madrid), false);
  assertEquals(isReservationTimeTooSoon('14/10/2026', '13:01', now, madrid), false);
  const withSeconds = new Date('2026-10-14T10:30:30.000Z');
  assertEquals(isReservationTimeTooSoon('14/10/2026', '13:00', withSeconds, madrid), true);
  assertEquals(isReservationTimeTooSoon('14/10/2026', '13:01', withSeconds, madrid), false);
  assertEquals(isReservationTimeTooSoon('15/10/2026', '00:00', now, madrid), false);
  assertEquals(isReservationTimeTooSoon('13/10/2026', '23:59', now, madrid), true);
});

Deno.test('uses Madrid local date across midnight rather than UTC date', () => {
  const now = new Date('2026-10-14T22:30:00.000Z'); // 15/10 00:30 in Madrid
  assertEquals(isReservationTimeTooSoon('14/10/2026', '23:59', now, madrid), true);
  assertEquals(isReservationTimeTooSoon('15/10/2026', '00:59', now, madrid), true);
  assertEquals(isReservationTimeTooSoon('15/10/2026', '01:00', now, madrid), false);
});

Deno.test('keeps the comparison correct on both Madrid daylight-saving transitions', () => {
  const springForward = new Date('2026-03-29T01:30:00.000Z'); // 03:30 CEST
  assertEquals(isReservationTimeTooSoon('29/03/2026', '03:59', springForward, madrid), true);
  assertEquals(isReservationTimeTooSoon('29/03/2026', '04:00', springForward, madrid), false);

  const fallBack = new Date('2026-10-25T01:30:00.000Z'); // 02:30 CET, repeated local hour
  assertEquals(isReservationTimeTooSoon('25/10/2026', '02:29', fallBack, madrid), true);
  assertEquals(isReservationTimeTooSoon('25/10/2026', '03:00', fallBack, madrid), false);
});

Deno.test('availability hides elapsed slots without changing capacity accounting', () => {
  const result = getAvailableHoursByCapacity([
    { hora: '12:00', limite: 4, activo: true },
    { hora: '13:00', limite: 4, activo: true },
    { hora: '13:01', limite: 4, activo: true },
  ], [{ fecha: '2026-10-14', hora: '13:00', pax: 3, estado: 'CONFIRMADA' }], '2026-10-14', 2, new Date('2026-10-14T10:30:00.000Z'));

  assertEquals(result.horas_disponibles, ['13:01']);
});

Deno.test('availability accepts the ISO date format used by its endpoint', () => {
  const result = getAvailableHoursByCapacity([
    { hora: '12:59', limite: 4, activo: true },
    { hora: '13:00', limite: 4, activo: true },
  ], [], '2026-10-14', 1, new Date('2026-10-14T10:30:00.000Z'));

  assertEquals(result.horas_disponibles, ['13:00']);
});
