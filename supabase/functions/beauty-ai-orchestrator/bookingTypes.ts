export const BOOKING_STATUSES = [
  'idle',
  'choosing_service',
  'choosing_date',
  'choosing_time',
  'awaiting_confirmation',
  'awaiting_human_confirmation',
  'completed',
  'cancelled',
  'expired',
] as const;

export type BookingStatus = typeof BOOKING_STATUSES[number];

export const BOOKING_INTENTS = [
  'ask_information',
  'choose_service',
  'choose_date',
  'choose_time',
  'confirm',
  'reject',
  'change_selection',
  'request_human',
  'unknown',
] as const;

export type BookingIntent = typeof BOOKING_INTENTS[number];

export type BookingInterpretation = {
  intent: BookingIntent;
  service_reference: string | null;
  date_expression: string | null;
  time_expression: string | null;
  option_reference: 'first' | 'second' | 'last' | 'that' | null;
  confirmation: boolean | null;
  wants_human: boolean;
  confidence: number;
};

export type OfferedTime = {
  starts_at: string;
  staff_id: string;
  label: string;
};

export type BookingErrorCode =
  | 'INTERPRETATION_INVALID'
  | 'INTERPRETATION_LOW_CONFIDENCE'
  | 'SERVICE_NOT_RESOLVED'
  | 'DATE_INVALID'
  | 'DATE_OUT_OF_RANGE'
  | 'TIME_NOT_OFFERED'
  | 'OFFER_EXPIRED'
  | 'AVAILABILITY_CHANGED'
  | 'AVAILABILITY_UNAVAILABLE'
  | 'SESSION_CONFLICT'
  | 'MESSAGE_SEND_FAILED'
  | 'MANUAL_TAKEOVER'
  | 'SUPERSEDED_BY_NEWER_INBOUND';

export type HandoffReason =
  | 'booking_confirmation'
  | 'requested'
  | 'complaint'
  | 'urgent'
  | 'confused'
  | 'unsupported';

export type BookingSession = {
  id: string;
  business_id: string;
  conversation_id: string;
  status: BookingStatus;
  service_id: string | null;
  staff_id: string | null;
  selected_date: string | null;
  offered_times: OfferedTime[];
  selected_starts_at: string | null;
  source_ai_run_id: string | null;
  last_processed_inbound_message_id: string | null;
  last_response_message_id: string | null;
  last_interpretation_intent: BookingIntent | null;
  last_error_code: BookingErrorCode | null;
  handoff_reason: HandoffReason | null;
  version: number;
  availability_checked_at: string | null;
  expires_at: string;
};

export type ResolvedBookingInput = {
  serviceId: string | null;
  selectedDate: string | null;
  selectedOption: OfferedTime | null;
  requestedTime?: string | null;
  serviceExplicit?: boolean;
  dateExplicit?: boolean;
  availabilityOptions?: OfferedTime[];
  revalidation?: 'available' | 'unavailable';
  expired: boolean;
};

export type BookingOperation =
  | 'none'
  | 'list_services'
  | 'query_availability'
  | 'revalidate_selected'
  | 'send_handoff';

export type BookingDecision = {
  next: BookingSession | null;
  operation: BookingOperation;
  reply: string;
  createSession: boolean;
  handoff: boolean;
  errorCode: BookingErrorCode | null;
};
