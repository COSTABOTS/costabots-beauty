import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { buildHandoffSessionUpdate, canAwaitHumanConfirmation } from './bookingSessionDomain.ts';
import type { BookingSession } from './bookingTypes.ts';

const session: BookingSession = {
  id: '1', business_id: '2', conversation_id: '3', status: 'awaiting_confirmation',
  service_id: '4', staff_id: '5', selected_date: '2026-08-03',
  offered_times: [{ starts_at: '2026-08-03T09:00:00+02:00', staff_id: '5', label: '09:00' }],
  selected_starts_at: '2026-08-03T09:00:00+02:00', source_ai_run_id: '6',
  last_processed_inbound_message_id: '7', last_response_message_id: null,
  last_interpretation_intent: 'confirm', last_error_code: null, handoff_reason: null,
  version: 3, availability_checked_at: '2026-08-01T10:00:00Z', expires_at: '2026-08-01T10:30:00Z',
};

Deno.test('human confirmation requires a complete selected slot', () => {
  assertEquals(canAwaitHumanConfirmation(session), true);
  assertThrows(() => buildHandoffSessionUpdate({ ...session, selected_date: null }, '8', 'booking_confirmation'));
  assertThrows(() => buildHandoffSessionUpdate({ ...session, selected_starts_at: null }, '8', 'booking_confirmation'));
});

Deno.test('handoff update keeps inbound response status and version in one turn', () => {
  assertEquals(buildHandoffSessionUpdate(session, '8', 'booking_confirmation'), {
    status: 'awaiting_human_confirmation',
    last_processed_inbound_message_id: '7',
    last_response_message_id: '8',
    handoff_reason: 'booking_confirmation',
    version: 4,
  });
});

Deno.test('unsupported handoff cannot force awaiting human confirmation', () => {
  assertEquals(buildHandoffSessionUpdate({ ...session, status: 'choosing_date' }, '8', 'unsupported').status, 'choosing_date');
});
