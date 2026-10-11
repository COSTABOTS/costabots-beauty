import { assertEquals } from 'jsr:@std/assert@1';
import {
  buildDayBeforeReminder,
  isCanonicalReminderPhone,
  isRemindersDryRun,
  reminderClientRequestId,
  retryDisposition,
} from './reminderDispatcher.ts';

Deno.test('dry-run is safe by default and only explicit false enables delivery', () => {
  assertEquals(isRemindersDryRun(undefined), true);
  assertEquals(isRemindersDryRun('true'), true);
  assertEquals(isRemindersDryRun('false'), false);
});

Deno.test('reminder key is revision-specific and idempotent', () => {
  assertEquals(reminderClientRequestId('appointment-a', 1), 'reminder:appointment-a:day_before:r1');
  assertEquals(reminderClientRequestId('appointment-a', 2), 'reminder:appointment-a:day_before:r2');
});

Deno.test('message copy uses business timezone and excludes internal data', () => {
  assertEquals(buildDayBeforeReminder({
    conversationId: 'conversation-a', businessName: 'AURA Studio', timezone: 'Europe/Madrid', phone: '+34600111222', instanceName: 'private',
    startsAt: '2026-10-13T08:30:00Z', serviceName: 'Corte', staffName: 'Ana',
  }), 'Hola, te recordamos que mañana tienes una cita en AURA Studio a las 10:30 para Corte con Ana.');
});

Deno.test('canonical phone and retry policy are conservative', () => {
  assertEquals(isCanonicalReminderPhone('+34600111222'), true);
  assertEquals(isCanonicalReminderPhone('600111222'), false);
  assertEquals(retryDisposition(1, 'WHATSAPP_DISCONNECTED'), { status: 'pending', errorCode: 'WHATSAPP_DISCONNECTED', delayMinutes: 5 });
  assertEquals(retryDisposition(3, 'WHATSAPP_DISCONNECTED'), { status: 'failed', errorCode: 'WHATSAPP_DISCONNECTED', delayMinutes: null });
});
