import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type {
  BookingDecision,
  BookingIntent,
  BookingSession,
  BookingStatus,
  HandoffReason,
} from './bookingTypes.ts';
import { buildHandoffSessionUpdate } from './bookingSessionDomain.ts';

const ACTIVE_STATUSES: BookingStatus[] = [
  'idle',
  'choosing_service',
  'choosing_date',
  'choosing_time',
  'awaiting_confirmation',
  'awaiting_human_confirmation',
];

export class BookingSessionConflict extends Error {
  constructor() {
    super('SESSION_CONFLICT');
    this.name = 'BookingSessionConflict';
  }
}

export type BookingConfirmationResult = {
  outcome: 'confirmed' | 'unavailable';
  appointment_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  service_name: string | null;
  staff_display_name: string | null;
  customer_id: string | null;
  offered_times: import('./bookingTypes.ts').OfferedTime[];
  session_version: number;
};

export async function confirmBookingSession(client: SupabaseClient, input: {
  businessId: string;
  conversationId: string;
  sessionId: string;
  inboundMessageId: string;
  expectedVersion: number;
}): Promise<BookingConfirmationResult> {
  const result = await client.rpc('confirm_beauty_booking_session', {
    p_business_id: input.businessId,
    p_conversation_id: input.conversationId,
    p_booking_session_id: input.sessionId,
    p_inbound_message_id: input.inboundMessageId,
    p_expected_version: input.expectedVersion,
  });
  if (result.error || !Array.isArray(result.data) || !result.data[0]) {
    throw new Error('BOOKING_CONFIRMATION_FAILED');
  }
  return result.data[0] as BookingConfirmationResult;
}

export async function recordBookingConfirmationResponse(client: SupabaseClient, input: {
  businessId: string;
  sessionId: string;
  inboundMessageId: string;
  responseMessageId: string;
}) {
  const result = await client.rpc('record_beauty_booking_confirmation_response', {
    p_business_id: input.businessId,
    p_booking_session_id: input.sessionId,
    p_inbound_message_id: input.inboundMessageId,
    p_response_message_id: input.responseMessageId,
  });
  if (result.error) throw new Error('BOOKING_CONFIRMATION_RESPONSE_FAILED');
}
export async function loadActiveBookingSession(
  client: SupabaseClient,
  businessId: string,
  conversationId: string,
): Promise<BookingSession | null> {
  const result = await client.from('beauty_booking_sessions').select('*')
    .eq('business_id', businessId)
    .eq('conversation_id', conversationId)
    .in('status', ACTIVE_STATUSES)
    .maybeSingle();
  if (result.error) throw new Error('BOOKING_SESSION_READ_FAILED');
  return result.data as BookingSession | null;
}

export function initialSessionValues(input: {
  businessId: string;
  conversationId: string;
  runId: string;
  inboundMessageId: string;
  status: Exclude<BookingStatus, 'idle' | 'completed' | 'cancelled' | 'expired'>;
  intent: BookingIntent;
  serviceId?: string | null;
  selectedDate?: string | null;
  expiresAt: string;
}) {
  return {
    business_id: input.businessId,
    conversation_id: input.conversationId,
    status: input.status,
    service_id: input.serviceId ?? null,
    staff_id: null,
    selected_date: input.selectedDate ?? null,
    offered_times: [],
    selected_starts_at: null,
    source_ai_run_id: input.runId,
    last_processed_inbound_message_id: input.inboundMessageId,
    last_interpretation_intent: input.intent,
    version: 1,
    expires_at: input.expiresAt,
  };
}

export async function createBookingSession(
  client: SupabaseClient,
  values: ReturnType<typeof initialSessionValues>,
): Promise<BookingSession> {
  const result = await client.from('beauty_booking_sessions').insert(values).select('*').single();
  if (result.error?.code === '23505') throw new BookingSessionConflict();
  if (result.error || !result.data) throw new Error('BOOKING_SESSION_WRITE_FAILED');
  return result.data as BookingSession;
}

export async function saveBookingDecision(
  client: SupabaseClient,
  previous: BookingSession,
  decision: BookingDecision,
  inboundMessageId: string,
  runId: string,
): Promise<BookingSession> {
  if (!decision.next) throw new Error('BOOKING_SESSION_WRITE_FAILED');
  const next = decision.next;
  const result = await client.from('beauty_booking_sessions').update({
    status: next.status,
    service_id: next.service_id,
    staff_id: next.staff_id,
    selected_date: next.selected_date,
    offered_times: next.offered_times,
    selected_starts_at: next.selected_starts_at,
    source_ai_run_id: runId,
    last_processed_inbound_message_id: inboundMessageId,
    last_interpretation_intent: next.last_interpretation_intent,
    last_error_code: next.last_error_code,
    handoff_reason: next.handoff_reason,
    availability_checked_at: next.availability_checked_at,
    expires_at: next.expires_at,
    version: previous.version + 1,
  }).eq('id', previous.id)
    .eq('business_id', previous.business_id)
    .eq('conversation_id', previous.conversation_id)
    .eq('version', previous.version)
    .select('*').maybeSingle();
  if (result.error?.code === '23505' || (!result.error && !result.data)) {
    throw new BookingSessionConflict();
  }
  if (result.error || !result.data) throw new Error('BOOKING_SESSION_WRITE_FAILED');
  return result.data as BookingSession;
}

export async function completeHandoff(
  client: SupabaseClient,
  session: BookingSession,
  responseMessageId: string,
  reason: HandoffReason,
) {
  const update = buildHandoffSessionUpdate(session, responseMessageId, reason);
  const sessionResult = await client.from('beauty_booking_sessions').update(update)
    .eq('id', session.id)
    .eq('version', session.version)
    .eq('last_processed_inbound_message_id', session.last_processed_inbound_message_id)
    .select('id').maybeSingle();
  if (!sessionResult.data) throw new BookingSessionConflict();

  const conversationResult = await client.from('beauty_conversations').update({
    mode: 'manual',
    assigned_user_id: null,
    needs_attention: true,
    attention_reason: `AI_HANDOFF_${reason.toUpperCase()}`,
  }).eq('id', session.conversation_id)
    .eq('business_id', session.business_id)
    .eq('mode', 'ai')
    .select('id').maybeSingle();
  if (!conversationResult.data) throw new Error('MANUAL_TAKEOVER');
}
