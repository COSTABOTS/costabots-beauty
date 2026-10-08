import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBusinessTheme } from '../src/features/beauty/data/businessTheme.ts';
import { createBarberDemoSeed } from '../src/features/beauty/mock/barberDemo.ts';

const referenceInstant = new Date('2026-10-06T10:00:00Z');

test('barber demo selects the barber business type and theme', () => {
  const demo = createBarberDemoSeed(referenceInstant);
  assert.equal(demo.business.name, 'NØR Barber Club');
  assert.equal(demo.business.businessType, 'barber_shop');
  assert.equal(resolveBusinessTheme(demo.business.businessType), 'barber');
});

test('demo dates are generated relative to the current business date', () => {
  const demo = createBarberDemoSeed(referenceInstant);
  assert.equal(demo.today, '2026-10-06');
  assert.equal(demo.appointments.filter((item) => item.date === '2026-10-06').length, 6);
  assert.equal(demo.appointments.filter((item) => item.date === '2026-10-07').length, 4);
  assert.ok(demo.appointments.some((item) => item.date === '2026-10-10'));
});

test('every demo appointment references existing business data and has a coherent duration', () => {
  const demo = createBarberDemoSeed(referenceInstant);
  const customers = new Set(demo.customers.map((item) => item.id));
  const staff = new Set(demo.staff.map((item) => item.id));
  const services = new Map(demo.services.map((item) => [item.id, item]));
  for (const item of demo.appointments) {
    assert.ok(customers.has(item.customerId), `missing customer ${item.customerId}`);
    assert.ok(staff.has(item.staffId), `missing staff ${item.staffId}`);
    const service = services.get(item.serviceId);
    assert.ok(service, `missing service ${item.serviceId}`);
    const [startHour, startMinute] = item.start.split(':').map(Number);
    const [endHour, endMinute] = item.end.split(':').map(Number);
    assert.equal((endHour * 60 + endMinute) - (startHour * 60 + startMinute), service.durationMinutes);
  }
});

test('a fresh seed restores initial demo data without sharing mutations', () => {
  const edited = createBarberDemoSeed(referenceInstant);
  edited.business.name = 'Demo modificada';
  edited.appointments.pop();
  const restored = createBarberDemoSeed(referenceInstant);
  assert.equal(restored.business.name, 'NØR Barber Club');
  assert.equal(restored.appointments.length, 17);
});

test('demo conversations remain linked and represent only supported behavior', () => {
  const demo = createBarberDemoSeed(referenceInstant);
  const customers = new Set(demo.customers.map((item) => item.id));
  assert.ok(demo.conversations.every((item) => customers.has(item.customerId)));
  assert.ok(demo.conversations.some((item) => item.status === 'needs_human'));
  assert.ok(demo.conversations.some((item) => item.messages.some((message) => message.text.includes('ha quedado confirmada'))));
});
