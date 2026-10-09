import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canRequestPairingCode,
  normalizeInternationalPhone,
  pairingCodeFromProvider,
  shouldStopPairingPolling,
} from '../supabase/functions/_shared/beautyWhatsappPairing.ts';

test('normaliza únicamente teléfonos internacionales válidos', () => {
  assert.equal(normalizeInternationalPhone('+34 611 102 304'), '34611102304');
  assert.equal(normalizeInternationalPhone('0034 611 102 304'), '34611102304');
  assert.equal(normalizeInternationalPhone('600 000'), null);
  assert.equal(normalizeInternationalPhone('+00 600 000 000'), null);
});

test('no permite código para un negocio no autorizado ni una instancia conectada', () => {
  assert.equal(canRequestPairingCode(false, 'awaiting_qr'), false);
  assert.equal(canRequestPairingCode(true, 'connected'), false);
  assert.equal(canRequestPairingCode(true, 'awaiting_qr'), true);
});

test('acepta estructuras de Evolution para pairing y nunca usa base64', () => {
  assert.equal(pairingCodeFromProvider({ pairingCode: 'ABCD-1234' }), 'ABCD-1234');
  assert.equal(pairingCodeFromProvider({ pairing_code: 'ABCD-1234' }), 'ABCD-1234');
  assert.equal(pairingCodeFromProvider({ pairingCode: { code: 'ABCD-1234' } }), 'ABCD-1234');
  assert.equal(pairingCodeFromProvider({ code: 'ABCD-1234' }), null);
  assert.equal(pairingCodeFromProvider({ code: 'ABCD-1234' }, true), 'ABCD-1234');
  assert.equal(pairingCodeFromProvider({ base64: 'ABCD-1234' }, true), null);
  assert.equal(pairingCodeFromProvider({}), null);
  assert.equal(pairingCodeFromProvider({ pairingCode: '<script>' }), null);
});

test('el polling se detiene al conectar y el cambio QR/código conserva ambos métodos', () => {
  assert.equal(shouldStopPairingPolling('connected'), true);
  assert.equal(shouldStopPairingPolling('connecting'), false);
  const methods = ['code', 'qr'] as const;
  assert.deepEqual(methods, ['code', 'qr']);
});
