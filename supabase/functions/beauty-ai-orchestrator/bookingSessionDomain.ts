import type { BookingSession, HandoffReason } from './bookingTypes.ts';

export function canAwaitHumanConfirmation(session: BookingSession) {
  return Boolean(
    session.service_id
    && session.selected_date
    && session.selected_starts_at
    && session.offered_times.some((option) =>
      option.starts_at === session.selected_starts_at
      && option.staff_id === session.staff_id
    )
  );
}

export function buildHandoffSessionUpdate(
  session: BookingSession,
  responseMessageId: string,
  reason: HandoffReason,
) {
  if (!session.last_processed_inbound_message_id || !responseMessageId) {
    throw new Error('HANDOFF_TURN_INVALID');
  }
  const status = reason === 'booking_confirmation'
    ? 'awaiting_human_confirmation' as const
    : session.status;
  if (status === 'awaiting_human_confirmation' && !canAwaitHumanConfirmation(session)) {
    throw new Error('HANDOFF_SELECTION_INVALID');
  }
  return {
    status,
    last_processed_inbound_message_id: session.last_processed_inbound_message_id,
    last_response_message_id: responseMessageId,
    handoff_reason: reason,
    version: session.version + 1,
  };
}
