import assert from 'node:assert/strict';
import test from 'node:test';
import { activeServiceIds, copiedScheduleDraft, copyServiceSelectionToDraft, staffServiceChanges } from '../src/features/beauty/components/staffConfiguration.ts';

const services = [
  { id: 'cut', name: 'Corte', durationMinutes: 30, price: 20 },
  { id: 'color', name: 'Color', durationMinutes: 60, price: 45 },
] as never[];

const assignments = [
  { id: 'one', staffId: 'ana', serviceId: 'cut', durationMinutes: 45, price: 25, active: true },
  { id: 'two', staffId: 'ana', serviceId: 'color', durationMinutes: 60, price: 45, active: false },
] as never[];

test('service selection keeps only changed assignments and preserves target customisations', () => {
  const draft = new Map([
    ['cut', { active: true, durationMinutes: 45, price: 25 }],
    ['color', { active: true, durationMinutes: 60, price: 45 }],
  ]);
  assert.deepEqual(staffServiceChanges('ana', services, assignments, draft), [
    { serviceId: 'color', active: true, durationMinutes: null, price: null },
  ]);
});

test('select all and clear all can be represented without writes until save', () => {
  assert.deepEqual([...activeServiceIds('ana', assignments)], ['cut']);
  const all = new Map(services.map((service) => [service.id, { active: true, durationMinutes: service.durationMinutes, price: service.price }]));
  assert.equal(staffServiceChanges('ana', services, assignments, all).length, 2);
  const none = new Map(services.map((service) => [service.id, { active: false, durationMinutes: service.durationMinutes, price: service.price }]));
  assert.deepEqual(staffServiceChanges('ana', services, assignments, none).map((change) => change.serviceId), ['cut']);
});

test('copying services changes only the local selection and retains target prices and durations', () => {
  const target = new Map([
    ['cut', { active: false, durationMinutes: 50, price: 28 }],
    ['color', { active: false, durationMinutes: 60, price: 45 }],
  ]);
  const copied = copyServiceSelectionToDraft(target, 'ana', assignments);
  assert.deepEqual(copied.get('cut'), { active: true, durationMinutes: 50, price: 28 });
  assert.deepEqual(copied.get('color'), { active: false, durationMinutes: 60, price: 45 });
  assert.equal(target.get('cut')?.active, false);
});

test('copying a weekly schedule creates an independent local draft', () => {
  const source = [{ id: 'schedule-1', staffId: 'ana', dayOfWeek: 2, start: '09:00', end: '18:00', active: true }] as never[];
  const draft = copiedScheduleDraft('ana', source);
  draft[0].start = '10:00';
  assert.equal(source[0].start, '09:00');
});
