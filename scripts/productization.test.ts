import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beautyBusinessTypes,
  isBeautyBusinessType,
} from '../src/features/beauty/data/businessProfile.ts';
import { resolveBusinessTheme } from '../src/features/beauty/data/businessTheme.ts';
import { isValidPassword, PASSWORD_REQUIREMENTS } from '../src/features/auth/passwordPolicy.ts';
import {
  formatAppointmentSource,
  formatMessageTime,
  formatMoney,
  selectNextAppointment,
} from '../src/features/beauty/presentation.ts';
import {
  recommendedTemplate,
  serviceTemplates,
} from '../src/features/beauty/data/serviceTemplates.ts';

test('supports every commercial business type including barber shops', () => {
  assert.deepEqual(beautyBusinessTypes, [
    'nail_salon',
    'hair_salon',
    'barber_shop',
    'beauty_center',
    'other',
  ]);
  assert.equal(isBeautyBusinessType('barber_shop'), true);
  assert.equal(isBeautyBusinessType('restaurant'), false);
});

test('recommends the matching template without forcing one for other', () => {
  assert.equal(recommendedTemplate('nail_salon'), 'nail_salon');
  assert.equal(recommendedTemplate('hair_salon'), 'hair_salon');
  assert.equal(recommendedTemplate('barber_shop'), 'barber_shop');
  assert.equal(recommendedTemplate('beauty_center'), 'beauty_center');
  assert.equal(recommendedTemplate('other'), null);
});

test('barber template uses supported durations and expected editable suggestions', () => {
  assert.equal(serviceTemplates.barber_shop.length, 6);
  assert.ok(serviceTemplates.barber_shop.every((service) => service.category === 'barber'));
  assert.ok(serviceTemplates.barber_shop.every((service) => [15, 30, 45, 60, 75, 90, 120, 150, 180].includes(service.durationMinutes)));
});

test('resolves one visual preset per business type', () => {
  assert.equal(resolveBusinessTheme('nail_salon'), 'nails');
  assert.equal(resolveBusinessTheme('hair_salon'), 'hair');
  assert.equal(resolveBusinessTheme('barber_shop'), 'barber');
  assert.equal(resolveBusinessTheme('beauty_center'), 'beauty');
  assert.equal(resolveBusinessTheme('other'), 'neutral');
  assert.equal(resolveBusinessTheme('legacy-unknown'), 'neutral');
});

test('selects only a genuinely upcoming active appointment', () => {
  const base = { date: '2026-10-06', customerId: 'customer', serviceId: 'service', staffId: 'staff', notes: '', source: 'Manual' as const, history: [] };
  const appointments = [
    { ...base, id: 'completed', start: '09:00', end: '10:00', status: 'completed' as const },
    { ...base, id: 'cancelled', start: '10:00', end: '11:00', status: 'cancelled' as const },
    { ...base, id: 'no-show', start: '11:00', end: '12:00', status: 'no_show' as const },
    { ...base, id: 'past', start: '08:00', end: '09:00', status: 'confirmed' as const },
    { ...base, id: 'next', start: '13:00', end: '14:00', status: 'pending' as const },
  ];
  assert.equal(selectNextAppointment(appointments, '12:00')?.id, 'next');
  assert.equal(selectNextAppointment(appointments.slice(0, 4), '12:00'), undefined);
});

test('formats money, sources and message times for the business', () => {
  assert.match(formatMoney(25, 'EUR'), /25/);
  assert.match(formatMoney(25, 'USD'), /US\$|USD|\$/);
  assert.equal(formatAppointmentSource('Manual'), 'Creada manualmente');
  assert.equal(formatAppointmentSource('WhatsApp IA'), 'WhatsApp');
  assert.equal(formatMessageTime('2026-08-03T07:00:00Z', 'Europe/Madrid'), '09:00');
});

test('shares one password policy between signup and reset', () => {
  assert.equal(PASSWORD_REQUIREMENTS, 'Mínimo 10 caracteres, con letras y números.');
  assert.equal(isValidPassword('abcdefghij'), false);
  assert.equal(isValidPassword('1234567890'), false);
  assert.equal(isValidPassword('abc1234567'), true);
});
