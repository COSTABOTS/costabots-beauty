import {
  availabilityReply,
  bookingReplies,
  selectionReply,
  timeClarificationReply,
  unavailableTimeReply,
} from './bookingReplies.ts';
import { isAffirmative } from './bookingResolvers.ts';
import type {
  BookingDecision,
  BookingInterpretation,
  BookingSession,
  ResolvedBookingInput,
} from './bookingTypes.ts';

function clone(session: BookingSession): BookingSession {
  return { ...session, offered_times: [...session.offered_times] };
}

function withObservation(
  session: BookingSession,
  interpretation: BookingInterpretation,
  errorCode: BookingSession['last_error_code'] = null,
) {
  return {
    ...session,
    last_interpretation_intent: interpretation.intent,
    last_error_code: errorCode,
  };
}

function decision(
  next: BookingSession | null,
  reply: string,
  operation: BookingDecision['operation'] = 'none',
  extras: Partial<BookingDecision> = {},
): BookingDecision {
  return {
    next,
    reply,
    operation,
    createSession: false,
    handoff: false,
    errorCode: null,
    ...extras,
  };
}

export function reduceBookingState(input: {
  session: BookingSession | null;
  interpretation: BookingInterpretation;
  rawText: string;
  resolved: ResolvedBookingInput;
  dateLabel: string;
  nowIso: string;
}): BookingDecision {
  const { interpretation, resolved, rawText, dateLabel } = input;
  let session = input.session ? clone(input.session) : null;

  if (interpretation.wants_human || interpretation.intent === 'request_human') {
    if (!session) return decision(null, bookingReplies.humanRequested, 'send_handoff', { handoff: true });
    session = withObservation(session, interpretation);
    session.handoff_reason = 'requested';
    return decision(session, bookingReplies.humanRequested, 'send_handoff', { handoff: true });
  }

  if (!session) {
    if (interpretation.intent === 'ask_information') return decision(null, '', 'none');
    if (interpretation.intent === 'choose_service' && resolved.serviceId) {
      return decision(null, bookingReplies.askDate, 'none', { createSession: true });
    }
    if (interpretation.intent === 'choose_date' && resolved.selectedDate) {
      return decision(null, bookingReplies.askService, 'list_services', { createSession: true });
    }
    return decision(null, bookingReplies.askService, 'list_services', { createSession: true });
  }

  session = withObservation(session, interpretation);
  if (resolved.expired) {
    session.status = 'expired';
    session.offered_times = [];
    session.selected_starts_at = null;
    session.last_error_code = 'OFFER_EXPIRED';
    return decision(session, bookingReplies.expired, 'none', { errorCode: 'OFFER_EXPIRED' });
  }

  if (interpretation.intent === 'reject') {
    session.status = 'cancelled';
    session.offered_times = [];
    session.selected_starts_at = null;
    return decision(session, bookingReplies.cancelled);
  }

  const serviceExplicit = resolved.serviceExplicit === true;
  const dateExplicit = resolved.dateExplicit === true;

  // Explicit context changes take priority over time selection. Handling them
  // together also supports messages such as "corte el lunes a las 9".
  if (serviceExplicit || dateExplicit) {
    const serviceChanged = serviceExplicit && resolved.serviceId !== session.service_id;
    if (serviceExplicit && !resolved.serviceId) {
      session.last_error_code = 'SERVICE_NOT_RESOLVED';
      return decision(session, bookingReplies.askService, 'list_services', {
        errorCode: 'SERVICE_NOT_RESOLVED',
      });
    }
    if (dateExplicit && !resolved.selectedDate) {
      session.last_error_code = 'DATE_INVALID';
      return decision(session, bookingReplies.askDate, 'none', { errorCode: 'DATE_INVALID' });
    }

    if (serviceExplicit) session.service_id = resolved.serviceId;
    if (dateExplicit) session.selected_date = resolved.selectedDate;
    else if (serviceChanged) session.selected_date = null;
    session.staff_id = null;
    session.offered_times = [];
    session.selected_starts_at = null;

    if (!session.service_id) {
      session.status = 'choosing_service';
      return decision(session, bookingReplies.askService, 'list_services');
    }
    if (!session.selected_date) {
      session.status = 'choosing_date';
      return decision(session, bookingReplies.askDate);
    }

    session.status = 'choosing_time';
    if (resolved.availabilityOptions !== undefined) {
      session.offered_times = resolved.availabilityOptions;
      session.availability_checked_at = input.nowIso;
      if (resolved.requestedTime) {
        const option = resolved.availabilityOptions.find(({ label }) => label === resolved.requestedTime);
        if (option) {
          session.selected_starts_at = option.starts_at;
          session.staff_id = option.staff_id;
          session.status = 'awaiting_confirmation';
          return decision(session, selectionReply(dateLabel, option.label));
        }
        session.last_error_code = 'TIME_NOT_OFFERED';
        return decision(session, unavailableTimeReply(session.offered_times), 'none', {
          errorCode: 'TIME_NOT_OFFERED',
        });
      }
      return decision(
        session,
        resolved.availabilityOptions.length
          ? availabilityReply(dateLabel, resolved.availabilityOptions)
          : bookingReplies.noAvailability,
      );
    }
    return decision(session, '', 'query_availability');
  }

  if (session.status === 'choosing_service') {
    return decision(session, bookingReplies.askService, 'list_services');
  }
  if (session.status === 'choosing_date') {
    return decision(session, bookingReplies.askDate);
  }

  if (session.status === 'choosing_time') {
    if (resolved.availabilityOptions !== undefined) {
      session.offered_times = resolved.availabilityOptions;
      session.selected_starts_at = null;
      session.availability_checked_at = input.nowIso;
      return decision(
        session,
        resolved.availabilityOptions.length
          ? availabilityReply(dateLabel, resolved.availabilityOptions)
          : bookingReplies.noAvailability,
      );
    }
    if (resolved.selectedOption) {
      session.selected_starts_at = resolved.selectedOption.starts_at;
      session.staff_id = resolved.selectedOption.staff_id;
      session.status = 'awaiting_confirmation';
      return decision(session, selectionReply(dateLabel, resolved.selectedOption.label));
    }
    if (isAffirmative(rawText, interpretation)) {
      return decision(session, bookingReplies.chooseTimeBeforeConfirming);
    }
    if (resolved.requestedTime) {
      session.last_error_code = 'TIME_NOT_OFFERED';
      return decision(session, unavailableTimeReply(session.offered_times), 'none', {
        errorCode: 'TIME_NOT_OFFERED',
      });
    }
    return decision(session, timeClarificationReply(session.offered_times));
  }

  if (session.status === 'awaiting_confirmation') {
    if (interpretation.intent === 'choose_time' && resolved.selectedOption) {
      session.selected_starts_at = resolved.selectedOption.starts_at;
      session.staff_id = resolved.selectedOption.staff_id;
      return decision(session, selectionReply(dateLabel, resolved.selectedOption.label));
    }
    if (!isAffirmative(rawText, interpretation)) {
      return decision(session, selectionReply(
        dateLabel,
        session.offered_times.find((option) => option.starts_at === session.selected_starts_at)?.label ?? '',
      ));
    }
    if (!resolved.revalidation) return decision(session, '', 'revalidate_selected');
    if (resolved.revalidation === 'unavailable') {
      session.status = 'choosing_time';
      session.selected_starts_at = null;
      session.offered_times = resolved.availabilityOptions ?? [];
      session.last_error_code = 'AVAILABILITY_CHANGED';
      return decision(
        session,
        resolved.availabilityOptions?.length
          ? `${bookingReplies.unavailable} ${availabilityReply(dateLabel, resolved.availabilityOptions)}`
          : bookingReplies.noAvailability,
        'none',
        {
        errorCode: 'AVAILABILITY_CHANGED',
        },
      );
    }
    session.handoff_reason = 'booking_confirmation';
    return decision(session, bookingReplies.handoff, 'send_handoff', { handoff: true });
  }

  if (session.status === 'awaiting_human_confirmation') {
    return decision(session, bookingReplies.handoff);
  }

  return decision(session, bookingReplies.clarify);
}
