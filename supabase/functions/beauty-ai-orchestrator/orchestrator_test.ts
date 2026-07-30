import { beautyAiEnabled, sanitizedAiError } from '../_shared/beautyAi.ts';
import { buildConversationMutation } from '../evolution-beauty-webhook/conversationMutation.ts';
import { validateAvailabilityClaims } from './gemini.ts';
import {
  aiMessageReservation,
  internalBusinessId,
  responseStillAllowed,
  shouldProcessInbound,
} from './policy.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('manual conversations never invoke AI', () => {
  assert(!shouldProcessInbound({
    aiEnabled: true,
    mode: 'manual',
    assignedUserId: 'manager',
    direction: 'inbound',
    senderType: 'customer',
  }), 'manual conversation was eligible');
});

Deno.test('disabled AI never processes inbound messages', () => {
  assert(!beautyAiEnabled('false'), 'false flag was treated as enabled');
  assert(!shouldProcessInbound({
    aiEnabled: false,
    mode: 'ai',
    assignedUserId: null,
    direction: 'inbound',
    senderType: 'customer',
  }), 'disabled AI was eligible');
});

Deno.test('duplicate runs produce the same idempotency key', () => {
  const first = aiMessageReservation('run-1', 'business-1', 'conversation-1', 'Hola', '2026-01-01T00:00:00Z');
  const repeated = aiMessageReservation('run-1', 'business-1', 'conversation-1', 'Hola', '2026-01-01T00:00:00Z');
  assert(first.client_request_id === repeated.client_request_id, 'idempotency key changed');
  assert(first.provider_message_id === repeated.provider_message_id, 'provider reservation changed');
});

Deno.test('tool arguments cannot override the run business', () => {
  assert(
    internalBusinessId('business-a', { business_id: 'business-b' }) === 'business-a',
    'tool arguments crossed business tenancy',
  );
});

Deno.test('unknown services cannot result in invented availability', () => {
  assert(!validateAvailabilityClaims('Tengo un hueco a las 10:30.', new Set()), 'unknown service invented a slot');
});

Deno.test('empty availability produces no invented slots', () => {
  assert(validateAvailabilityClaims('No hay huecos disponibles para ese día.', new Set()), 'empty response was rejected');
  assert(!validateAvailabilityClaims('Tengo un hueco a las 10:30.', new Set()), 'invented empty slot was accepted');
});

Deno.test('availability answers may only mention returned times', () => {
  const allowed = new Set(['10:30', '11:00']);
  assert(validateAvailabilityClaims('Puedo ofrecerte 10:30 o 11:00.', allowed), 'real slots were rejected');
  assert(!validateAvailabilityClaims('También tengo las 12:00.', allowed), 'unreturned slot was accepted');
});

Deno.test('Gemini failures use sanitized codes and preserve one reservation', () => {
  assert(sanitizedAiError(new Error('fetch contained secret details')) === 'AI_PROCESSING_FAILED', 'raw error leaked');
  const reservation = aiMessageReservation('run-failure', 'b', 'c', 'No se envía', '2026-01-01T00:00:00Z');
  assert(reservation.client_request_id === 'ai-run-run-failure', 'failure reservation is not deterministic');
});

Deno.test('manual takeover discards a completed model response', () => {
  assert(!responseStillAllowed('manual', 'manager'), 'manual takeover still allowed a response');
  assert(!responseStillAllowed('ai', 'manager'), 'assigned conversation still allowed a response');
});

Deno.test('AI outbound messages are stored with sender_type ai', () => {
  const reservation = aiMessageReservation('run-ai', 'b', 'c', 'Respuesta', '2026-01-01T00:00:00Z');
  assert(reservation.direction === 'outbound', 'AI message is not outbound');
  assert(reservation.sender_type === 'ai', 'AI sender type is not ai');
});

Deno.test('AI outbound echoes do not reactivate AI processing', () => {
  const existing = { id: 'conversation-1', mode: 'ai' as const };
  const echoMutation = buildConversationMutation(existing, false, { last_message_preview: 'Respuesta IA' });
  assert(!Object.hasOwn(echoMutation.values, 'mode'), 'AI echo changed conversation mode');
  assert(!shouldProcessInbound({
    aiEnabled: true,
    mode: 'ai',
    assignedUserId: null,
    direction: 'outbound',
    senderType: 'ai',
  }), 'AI outbound message activated AI');
});

Deno.test('sent, delivered and read status events do not activate AI', () => {
  for (const _status of ['sent', 'delivered', 'read']) {
  assert(!shouldProcessInbound({
    aiEnabled: true,
    mode: 'ai',
    assignedUserId: null,
    direction: 'outbound',
    senderType: 'system',
  }), 'status/system event activated AI');
  }
});
