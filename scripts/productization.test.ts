import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beautyBusinessTypes,
  isBeautyBusinessType,
} from '../src/features/beauty/data/businessProfile.ts';
import { resolveBusinessTheme } from '../src/features/beauty/data/businessTheme.ts';
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
