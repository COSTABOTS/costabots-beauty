import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { askDateForActiveSession, askDateForService, ambiguousServiceReply, bookingReplies, availabilityReply, clarifyProfessionalReply, dateWindowReply, incompatibleProfessionalReply, inconsistentDateReply, pendingFieldReply, professionalReply, selectionReply, unavailableTimeReply } from './bookingReplies.ts';
import { boundedCustomerContext, interpretBookingMessage, redactInterpreterText } from './bookingInterpreter.ts';
import {
  confirmBookingSession,
  clearBookingResumePrompt,
  createBookingSession,
  initialSessionValues,
  loadActiveBookingSession,
  loadLatestCompletedBookingSession,
  recordBookingConfirmationResponse,
  recordBookingResumePrompt,
  saveBookingDecision,
} from './bookingSessionRepository.ts';
import {
  deterministicDateOverride,
  isExistingAppointmentCancellation,
  isExistingAppointmentReschedule,
  interpretBookingDeterministically,
  normalizeRequestedTime,
  optionStillOffered,
  resolveRequestedDate,
  resolveServiceReference,
  resolveStaffReference,
  resolveStaffReferenceInText,
  resolveStaffFromCatalog,
  resolveTimeExpression,
  isIndifferentStaffPreference,
  extractStaffReference,
  hasExplicitStaffReference,
  isAffirmative,
  isBookingStatusQuestion,
} from './bookingResolvers.ts';
import { reduceBookingState } from './bookingStateMachine.ts';
import { getAvailability, listActiveBusinessStaff, listCompatibleStaff, listServices } from './tools.ts';
import { formatCustomerDate, type TemporalContext } from './dateResolution.ts';
import type {
  BookingDecision,
  BookingInterpretation,
  BookingSession,
  OfferedTime,
  OfferedProfessional,
  ResolvedBookingInput,
} from './bookingTypes.ts';
import { pendingBookingField } from './bookingTypes.ts';
import { professionalClarificationGate, professionalGate as professionalGateState } from './professionalSelection.ts';
import { resolveServiceText } from './serviceAliases.ts';

const MIN_INTERPRETATION_CONFIDENCE = 0.55;
const SESSION_TTL_MS = 30 * 60 * 1000;

function confirmationReply(result: {
  starts_at: string | null;
  service_name: string | null;
  staff_display_name: string | null;
}, timezone: string) {
  if (!result.starts_at || !result.staff_display_name) throw new Error('BOOKING_CONFIRMATION_RESULT_INVALID');
  const instant = new Date(result.starts_at);
  const date = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone,
  }).format(instant);
  const time = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
  }).format(instant);
  const service = result.service_name ? ` de ${result.service_name.toLocaleLowerCase('es-ES')}` : '';
  return `Tu cita${service} ha quedado confirmada para el ${date} a las ${time} con ${result.staff_display_name}.`;
}

function isGreeting(text: string) {
  const normalized = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches)\b/.test(normalized);
}

function isGreetingOnly(text: string) {
  const normalized = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches)[!.]*$/.test(normalized);
}

function selectedOffer(session: BookingSession) {
  return session.offered_times.find((option) => option.starts_at === session.selected_starts_at) ?? null;
}

function pendingConfirmationReply(session: BookingSession, timezone: string) {
  const selected = selectedOffer(session);
  if (!selected || !session.selected_date) return bookingReplies.pendingBookingStatus;
  return `Todavía no está confirmada. Tienes pendiente ${formatCustomerDate(session.selected_date, timezone)} a las ${selected.label} con ${selected.staff_display_name ?? 'el profesional seleccionado'}.`;
}

export function resumeAnswer(text: string) {
  const normalized = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  if (/^(si|vale|de acuerdo|claro|continua|continuar)$/u.test(normalized)) return 'yes' as const;
  if (/^(no|cancelar|cancela|dejalo)$/u.test(normalized)) return 'no' as const;
  return null;
}

export function resumeReplyForSession(session: BookingSession, services: CatalogService[], timezone: string) {
  if (session.status === 'choosing_service') return bookingReplies.askService;
  if (session.status === 'choosing_professional') return professionalReply(session.offered_professionals ?? []);
  if (session.status === 'choosing_date') {
    return askDateForActiveSession(services.find(({ id }) => id === session.service_id)?.name ?? null);
  }
  if (session.status === 'choosing_time') return bookingReplies.askTime;
  if (session.status === 'awaiting_confirmation') {
    const selected = selectedOffer(session);
    if (selected && session.selected_date) {
      return selectionReply(formatCustomerDate(session.selected_date, timezone), selected.label, selected.staff_display_name);
    }
  }
  return pendingFieldReply(pendingBookingField(session), session.offered_times);
}

async function isPendingResumePrompt(client: SupabaseClient, session: BookingSession) {
  if (!session.last_response_message_id) return false;
  const result = await client.from('beauty_messages')
    .select('direction,sender_type,text_content')
    .eq('id', session.last_response_message_id)
    .eq('business_id', session.business_id)
    .eq('conversation_id', session.conversation_id)
    .maybeSingle();
  return !result.error
    && result.data?.direction === 'outbound'
    && result.data?.sender_type === 'ai'
    && result.data?.text_content === bookingReplies.pendingBookingGreeting;
}

function confirmedStatusReply(session: BookingSession, services: CatalogService[], timezone: string) {
  const selected = selectedOffer(session);
  if (!selected || !session.selected_date) return 'Sí, tu cita está confirmada.';
  const service = services.find(({ id }) => id === session.service_id)?.name;
  return `Sí, tu cita${service ? ` de ${service.toLocaleLowerCase('es')}` : ''} está confirmada para ${formatCustomerDate(session.selected_date, timezone)} a las ${selected.label} con ${selected.staff_display_name ?? 'el profesional asignado'}.`;
}

type FlowContext = {
  runId: string;
  businessId: string;
  conversationId: string;
  inboundMessageId: string;
};

async function contextualDatePrompt(
  client: SupabaseClient,
  businessId: string,
  session: BookingSession,
) {
  if (session.status !== 'choosing_date' || !session.service_id) return bookingReplies.askDate;
  try {
    const result = await listServices(client, businessId);
    const services = (result.services ?? []) as Array<{ id: string; name: string }>;
    return askDateForActiveSession(services.find(({ id }) => id === session.service_id)?.name ?? null);
  } catch {
    return bookingReplies.askDate;
  }
}

const MAX_VISIBLE_OFFERS = 5;

function availableOptions(value: Record<string, unknown>): OfferedTime[] {
  const rows = Array.isArray(value.slots) ? value.slots as Array<Record<string, unknown>> : [];
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const option = {
      starts_at: String(row.starts_at ?? ''),
      staff_id: String(row.staff_id ?? ''),
      staff_display_name: String(row.staff_display_name ?? ''),
      label: String(row.label ?? ''),
    };
    const key = `${option.starts_at}|${option.staff_id}`;
    if (!option.starts_at || !option.staff_id || !option.staff_display_name || !/^\d{2}:\d{2}$/.test(option.label) || seen.has(key)) return [];
    seen.add(key);
    return [option];
  });
}

export function visibleAvailability(options: OfferedTime[]) {
  return {
    options: options.slice(0, MAX_VISIBLE_OFFERS),
    hasMore: options.length > MAX_VISIBLE_OFFERS,
  };
}

async function availability(
  client: SupabaseClient,
  context: FlowContext,
  session: BookingSession,
) {
  if (!session.service_id || !session.selected_date) return { options: [], allOptions: [], hasMore: false };
  const result = await getAvailability(client, context.businessId, {
    service_id: session.service_id,
    date: session.selected_date,
    staff_id: session.staff_id,
  });
  const allOptions = availableOptions(result);
  return { ...visibleAvailability(allOptions), allOptions };
}

export function optionForRequestedTime(options: OfferedTime[], requestedTime: string) {
  // The availability RPC sorts its real slots. With an indifferent preference,
  // the first exact match is deterministic and its professional is named in
  // the confirmation copy.
  return options.find((option) => option.label === requestedTime) ?? null;
}

export function persistExactOption(visibleOptions: OfferedTime[], option: OfferedTime | null) {
  if (!option || visibleOptions.some((visible) => visible.starts_at === option.starts_at && visible.staff_id === option.staff_id)) {
    return visibleOptions;
  }
  // An explicitly selected off-list slot is persisted with the visible sample
  // so the confirmation RPC remains bound to the exact staff+instant pair.
  return [...visibleOptions, option];
}

function minutesFromLabel(label: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(label);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function nearbyAvailabilityOptions(options: OfferedTime[], requestedTime: string, fallback: OfferedTime[]) {
  const requestedMinutes = minutesFromLabel(requestedTime);
  if (requestedMinutes === null) return fallback;
  const nearby = [...options].sort((left, right) => {
    const leftDistance = Math.abs((minutesFromLabel(left.label) ?? requestedMinutes) - requestedMinutes);
    const rightDistance = Math.abs((minutesFromLabel(right.label) ?? requestedMinutes) - requestedMinutes);
    return leftDistance - rightDistance || left.starts_at.localeCompare(right.starts_at) || left.staff_id.localeCompare(right.staff_id);
  }).slice(0, 3);
  return nearby.length ? nearby : fallback;
}

function initialStatus(serviceId: string | null, date: string | null) {
  if (!serviceId) return 'choosing_service' as const;
  if (!date) return 'choosing_date' as const;
  return 'choosing_time' as const;
}

async function compatibleProfessionals(
  client: SupabaseClient,
  businessId: string,
  serviceId: string,
): Promise<OfferedProfessional[]> {
  return await listCompatibleStaff(client, businessId, serviceId);
}

function professionalGate(session: BookingSession, professionals: OfferedProfessional[], selectedStaffId: string | null = null) {
  return {
    ...session,
    ...professionalGateState(professionals, selectedStaffId),
    offered_times: [],
    selected_starts_at: null,
  };
}

async function professionalGateForReference(input: {
  client: SupabaseClient;
  businessId: string;
  session: BookingSession;
  professionals: OfferedProfessional[];
  staffReference: string | null | undefined;
  serviceName: string | null;
}) {
  const requestedName = extractStaffReference(input.staffReference);
  if (!requestedName) return { gate: professionalGate(input.session, input.professionals), reply: null };
  const compatibleStaffId = resolveStaffFromCatalog(requestedName, input.professionals);
  if (compatibleStaffId) {
    return { gate: professionalGate(input.session, input.professionals, compatibleStaffId), reply: null };
  }
  // The wider active-staff lookup is used only to distinguish a real but
  // incompatible name from an unknown or homonymous reference. It never
  // supplies a selectable professional to the booking session.
  const activeStaff = await listActiveBusinessStaff(input.client, input.businessId);
  const activeStaffId = resolveStaffFromCatalog(requestedName, activeStaff);
  const activeStaffName = activeStaff.find((staff) => staff.staff_id === activeStaffId)?.staff_display_name ?? requestedName;
  return {
    gate: { ...input.session, ...professionalClarificationGate(input.professionals), offered_times: [], selected_starts_at: null },
    reply: activeStaffId
      ? incompatibleProfessionalReply(activeStaffName, input.serviceName, input.professionals)
      : clarifyProfessionalReply(),
  };
}

async function handoffConversationToHuman(
  client: SupabaseClient,
  context: FlowContext,
) {
  const result = await client.from('beauty_conversations').update({
    mode: 'manual',
    assigned_user_id: null,
    needs_attention: true,
    attention_reason: 'AI_HANDOFF_REQUESTED',
  }).eq('id', context.conversationId)
    .eq('business_id', context.businessId)
    .eq('mode', 'ai')
    .select('id').maybeSingle();
  if (result.error || !result.data) throw new Error('CANCELLATION_HANDOFF_FAILED');
}

type CatalogService = { id: string; name: string; description?: string | null };

function interpreterSummary(
  session: BookingSession | null,
  services: CatalogService[],
  recentCustomerMessages: string[],
) {
  const selected = session?.offered_times.find((option) => option.starts_at === session?.selected_starts_at);
  return {
    selected_service: session?.service_id ? services.find(({ id }) => id === session.service_id)?.name ?? null : null,
    selected_staff: selected?.staff_display_name ?? null,
    selected_date: session?.selected_date ?? null,
    selected_time: selected?.label ?? null,
    offered_times: (session?.offered_times ?? []).map((option) => ({ label: option.label, staff: option.staff_display_name ?? null })),
    offered_professionals: (session?.offered_professionals ?? []).map((professional) => professional.staff_display_name),
    service_catalog: services.slice(0, 50).map((service) => ({
      name: service.name,
      description: service.description ? redactInterpreterText(service.description).slice(0, 240) : null,
    })),
    recent_customer_messages: boundedCustomerContext(recentCustomerMessages),
    pending_field: pendingBookingField(session),
    last_intent: session?.last_interpretation_intent ?? null,
  };
}

export async function processBookingFlow(input: {
  client: SupabaseClient;
  context: FlowContext;
  text: string;
  temporal: TemporalContext;
  nowIso: string;
  sendReply: (text: string) => Promise<{ discarded: boolean; messageId?: string; reason?: string }>;
  recentCustomerMessages?: string[];
}) {
  const { client, context, temporal, nowIso } = input;
  let session = await loadActiveBookingSession(client, context.businessId, context.conversationId);
  const serviceResult = await listServices(client, context.businessId);
  const services = (serviceResult.services ?? []) as CatalogService[];
  // The response to the explicit re-entry question is not booking input. It
  // must be handled before date/time/professional parsing and consumed once.
  if (session && await isPendingResumePrompt(client, session)) {
    const answer = resumeAnswer(input.text);
    session = await clearBookingResumePrompt(client, session, context.inboundMessageId, context.runId);
    if (answer === 'yes') {
      const reply = resumeReplyForSession(session, services, temporal.timezone);
      const sent = await input.sendReply(reply);
      return { handled: true as const, sent, handoff: false, session, handoffReason: null };
    }
    if (answer === 'no') {
      const next = {
        ...session,
        status: 'cancelled' as const,
        offered_times: [],
        selected_starts_at: null,
        last_interpretation_intent: 'reject' as const,
        last_error_code: null,
      };
      session = await saveBookingDecision(client, session, {
        next, operation: 'none', reply: bookingReplies.cancelled,
        createSession: false, handoff: false, errorCode: null,
      }, context.inboundMessageId, context.runId);
      const sent = await input.sendReply(bookingReplies.cancelled);
      return { handled: true as const, sent, handoff: false, session, handoffReason: null };
    }
  }
  const deterministicDate = deterministicDateOverride(session?.status ?? null, input.text, temporal);
  let interpretation: BookingInterpretation | null = deterministicDate?.interpretation
    ?? interpretBookingDeterministically(input.text, session?.status ?? null, services, temporal, session);
  if (!interpretation) try {
    interpretation = await interpretBookingMessage({
      text: input.text,
      status: session?.status ?? null,
      temporal,
      summary: interpreterSummary(session, services, input.recentCustomerMessages ?? []),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'INTERPRETATION_INVALID') {
      const reply = session
        ? session.status === 'choosing_date' ? bookingReplies.clarifyDate : bookingReplies.clarify
        : bookingReplies.clarify;
      if (session) {
        const next = { ...session, last_error_code: 'INTERPRETATION_INVALID' as const };
        session = await saveBookingDecision(client, session, {
          next,
          operation: 'none',
          reply,
          createSession: false,
          handoff: false,
          errorCode: 'INTERPRETATION_INVALID',
        }, context.inboundMessageId, context.runId);
      }
      const sent = await input.sendReply(reply);
      return { handled: true as const, sent, handoff: false };
    }
    throw error;
  }
  if (!interpretation) throw new Error('INTERPRETATION_INVALID');

  // A booking-status question must never reach the general-information
  // generator: the session and completed appointment records are authoritative.
  if (isBookingStatusQuestion(input.text)) {
    const completed = session ? null : await loadLatestCompletedBookingSession(client, context.businessId, context.conversationId);
    const reply = session
      ? session.status === 'awaiting_confirmation'
        ? pendingConfirmationReply(session, temporal.timezone)
        : bookingReplies.pendingBookingStatus
      : completed?.appointment_id
      ? confirmedStatusReply(completed, services, temporal.timezone)
      : bookingReplies.noConfirmedBooking;
    const sent = await input.sendReply(reply);
    return { handled: true as const, sent, handoff: false };
  }

  // A greeting alone must not be parsed as a time choice. Expire only offers
  // that have actually elapsed; a live reservation remains intact and explicit.
  if (session && isGreetingOnly(input.text)) {
    if (Date.parse(session.expires_at) <= Date.parse(nowIso)) {
      const next = {
        ...session,
        status: 'expired' as const,
        offered_times: [],
        selected_starts_at: null,
        last_interpretation_intent: interpretation.intent,
        last_error_code: 'OFFER_EXPIRED' as const,
      };
      await saveBookingDecision(client, session, {
        next, operation: 'none', reply: bookingReplies.greeting,
        createSession: false, handoff: false, errorCode: 'OFFER_EXPIRED',
      }, context.inboundMessageId, context.runId);
      const sent = await input.sendReply(bookingReplies.greeting);
      return { handled: true as const, sent, handoff: false };
    }
    const sent = await input.sendReply(
      session.status === 'awaiting_confirmation'
        ? pendingConfirmationReply(session, temporal.timezone)
        : bookingReplies.pendingBookingGreeting,
    );
    if (sent.messageId && session.status !== 'awaiting_confirmation') {
      try {
        await recordBookingResumePrompt(client, session, sent.messageId);
      } catch {
        // The greeting was already delivered. A concurrent update merely means
        // the next turn follows the normal safe parser rather than resuming.
      }
    }
    return { handled: true as const, sent, handoff: false };
  }

  if (!session && interpretation.intent === 'ask_information') return { handled: false as const };
  if (!session && interpretation.intent === 'unknown') {
    const sent = await input.sendReply(bookingReplies.greeting);
    return { handled: true as const, sent, handoff: false };
  }

  // A cancellation of an existing appointment is deliberately never inferred
  // from booking state. There is no cancellation RPC in this flow, so hand it
  // to a person after the controlled reply instead of starting another booking.
  if (interpretation.intent === 'cancel_existing' || isExistingAppointmentCancellation(input.text)) {
    const sent = await input.sendReply(bookingReplies.cancellationNeedsHuman);
    if (!sent.discarded) await handoffConversationToHuman(client, context);
    return { handled: true as const, sent, handoff: true };
  }

  if (interpretation.intent === 'reschedule_existing' || isExistingAppointmentReschedule(input.text)) {
    // Preserve the confirmed appointment reference in its completed booking
    // session; this phase deliberately does not modify it without an RPC.
    const completedSession = await loadLatestCompletedBookingSession(client, context.businessId, context.conversationId);
    const reply = completedSession?.appointment_id
      ? bookingReplies.rescheduleNeedsHuman
      : bookingReplies.rescheduleWithoutReference;
    const sent = await input.sendReply(reply);
    if (!sent.discarded) await handoffConversationToHuman(client, context);
    return { handled: true as const, sent, handoff: true };
  }

  if (interpretation.intent === 'social') {
    const sent = await input.sendReply(session ? `${bookingReplies.thanks} ${bookingReplies.pendingBookingGreeting}` : bookingReplies.thanks);
    return { handled: true as const, sent, handoff: false };
  }

  if (interpretation.intent === 'out_of_domain') {
    const sent = await input.sendReply(bookingReplies.outOfDomain);
    return { handled: true as const, sent, handoff: false };
  }

  // Informational questions are answered by the constrained information
  // generator. The persisted reservation session remains untouched so a later
  // reply can continue from the pending field instead of starting over.
  if (session && interpretation.intent === 'ask_information') {
    return { handled: false as const };
  }

  const serviceExplicit = Boolean(interpretation.service_reference?.trim());
  const requestedServiceId = resolveServiceReference(interpretation.service_reference, services);
  const serviceTextResolution = resolveServiceText(input.text, services);

  if (serviceTextResolution.ambiguous) {
    const reply = ambiguousServiceReply(serviceTextResolution.candidates);
    if (session) {
      const next = { ...session, last_interpretation_intent: interpretation.intent, last_error_code: null };
      session = await saveBookingDecision(client, session, {
        next, operation: 'none', reply, createSession: false, handoff: false, errorCode: null,
      }, context.inboundMessageId, context.runId);
    }
    const sent = await input.sendReply(reply);
    return { handled: true as const, sent, handoff: false, session: session ?? undefined, handoffReason: null };
  }

  // Selecting a service is a complete turn. Do not reuse the same text as a
  // date expression or availability request, even when model confidence is low.
  if (session?.status === 'choosing_service' && serviceExplicit && requestedServiceId) {
    const serviceName = services.find(({ id }) => id === requestedServiceId)?.name ?? null;
    const professionals = await compatibleProfessionals(client, context.businessId, requestedServiceId);
    const gatedInput = {
      ...session,
      service_id: requestedServiceId,
      selected_date: null,
      offered_times: [],
      selected_starts_at: null,
      last_interpretation_intent: 'choose_service' as const,
      last_error_code: null,
    };
    const professionalResolution = professionals.length
      ? await professionalGateForReference({ client, businessId: context.businessId, session: gatedInput, professionals, staffReference: interpretation.staff_reference, serviceName })
      : { gate: professionalGate(gatedInput, professionals), reply: null };
    const gated = professionalResolution.gate;
    const next = professionals.length
      ? gated
      : { ...gated, status: 'choosing_service' as const, staff_preference: 'unasked' as const };
    const reply = professionalResolution.reply ?? (professionals.length === 1
      ? askDateForService(serviceName, false)
      : professionals.length > 1
      ? professionalReply(professionals)
      : bookingReplies.askService);
    session = await saveBookingDecision(client, session, {
      next,
      operation: 'none',
      reply,
      createSession: false,
      handoff: false,
      errorCode: null,
    }, context.inboundMessageId, context.runId);
    const sent = await input.sendReply(reply);
    return { handled: true as const, sent, handoff: false, session, handoffReason: null };
  }

  // A service change invalidates a previous professional choice. Re-enter the
  // same server-side gate instead of carrying a possibly incompatible staff id.
  if (session && serviceExplicit && requestedServiceId && requestedServiceId !== session.service_id) {
    const professionals = await compatibleProfessionals(client, context.businessId, requestedServiceId);
    const serviceName = services.find(({ id }) => id === requestedServiceId)?.name ?? null;
    const gatedInput = {
      ...session,
      service_id: requestedServiceId,
      selected_date: null,
      offered_times: [],
      selected_starts_at: null,
      last_interpretation_intent: 'choose_service' as const,
      last_error_code: null,
    };
    const professionalResolution = professionals.length
      ? await professionalGateForReference({ client, businessId: context.businessId, session: gatedInput, professionals, staffReference: interpretation.staff_reference, serviceName })
      : { gate: professionalGate(gatedInput, professionals), reply: null };
    const gated = professionalResolution.gate;
    const next = professionals.length
      ? gated
      : { ...gated, status: 'choosing_service' as const, staff_preference: 'unasked' as const };
    const reply = professionalResolution.reply ?? (professionals.length === 1
      ? askDateForService(serviceName, false)
      : professionals.length > 1
      ? professionalReply(professionals)
      : bookingReplies.askService);
    session = await saveBookingDecision(client, session, {
      next, operation: 'none', reply, createSession: false, handoff: false,
      errorCode: professionals.length ? null : 'SERVICE_NOT_RESOLVED',
    }, context.inboundMessageId, context.runId);
    const sent = await input.sendReply(reply);
    return { handled: true as const, sent, handoff: false, session, handoffReason: null };
  }

  // The selection list comes exclusively from the server-side compatibility
  // lookup saved on this session. Gemini may identify a name, but cannot add a
  // professional or decide whether a name is unambiguous.
  if (session?.status === 'choosing_professional') {
    const staffId = resolveStaffReference(interpretation.staff_reference ?? input.text, session);
    const indifferent = isIndifferentStaffPreference(input.text);
    if (!staffId && !indifferent) {
      const next = { ...session, last_interpretation_intent: interpretation.intent, last_error_code: null };
      session = await saveBookingDecision(client, session, {
        next, operation: 'none', reply: professionalReply(session.offered_professionals ?? []),
        createSession: false, handoff: false, errorCode: null,
      }, context.inboundMessageId, context.runId);
      const sent = await input.sendReply(professionalReply(session.offered_professionals ?? []));
      return { handled: true as const, sent, handoff: false, session, handoffReason: null };
    }
    const next = {
      ...session,
      status: 'choosing_date' as const,
      staff_id: staffId ?? null,
      staff_preference: indifferent ? 'indifferent' as const : 'selected' as const,
      offered_times: [],
      selected_starts_at: null,
      last_interpretation_intent: interpretation.intent,
      last_error_code: null,
    };
    session = await saveBookingDecision(client, session, {
      next, operation: 'none', reply: askDateForActiveSession(services.find(({ id }) => id === session!.service_id)?.name ?? null),
      createSession: false, handoff: false, errorCode: null,
    }, context.inboundMessageId, context.runId);
    const reply = askDateForActiveSession(services.find(({ id }) => id === session!.service_id)?.name ?? null);
    const sent = await input.sendReply(reply);
    return { handled: true as const, sent, handoff: false, session, handoffReason: null };
  }

  if (session && interpretation.intent === 'unknown') {
    const pending = pendingBookingField(session);
    const reply = pending === 'date'
      ? await contextualDatePrompt(client, context.businessId, session)
      : pendingFieldReply(pending, session.offered_times);
    const next = {
      ...session,
      last_interpretation_intent: 'unknown' as const,
      last_error_code: null,
    };
    session = await saveBookingDecision(client, session, {
      next,
      operation: 'none',
      reply,
      createSession: false,
      handoff: false,
      errorCode: null,
    }, context.inboundMessageId, context.runId);
    const sent = await input.sendReply(reply);
    return { handled: true as const, sent, handoff: false, session, handoffReason: null };
  }

  if (interpretation.confidence < MIN_INTERPRETATION_CONFIDENCE) {
    const reply = session ? pendingFieldReply(pendingBookingField(session), session.offered_times) : bookingReplies.lowConfidence;
    if (session) {
      const next = {
        ...session,
        last_interpretation_intent: interpretation.intent,
        last_error_code: 'INTERPRETATION_LOW_CONFIDENCE' as const,
      };
      session = await saveBookingDecision(client, session, {
        next,
        operation: 'none',
        reply,
        createSession: false,
        handoff: false,
        errorCode: 'INTERPRETATION_LOW_CONFIDENCE',
      }, context.inboundMessageId, context.runId);
    }
    const sent = await input.sendReply(reply);
    return { handled: true as const, sent, handoff: false };
  }

  const serviceId = serviceExplicit ? requestedServiceId : session?.service_id ?? null;
  const dateResolution = deterministicDate?.resolution
    ?? resolveRequestedDate(input.text, interpretation, temporal);
  const dateExplicit = dateResolution.status === 'resolved';
  const selectedDate = dateResolution.status === 'resolved'
    ? dateResolution.isoDate
    : session?.selected_date ?? null;
  const customerDateLabel = selectedDate
    ? formatCustomerDate(selectedDate, temporal.timezone)
    : 'ese día';

  const unresolvedDateReply = dateResolution.status === 'window'
    ? dateWindowReply(dateResolution.label)
    : dateResolution.status === 'inconsistent'
    ? inconsistentDateReply(
      dateResolution.day,
      dateResolution.actualWeekday,
      dateResolution.statedWeekday,
      dateResolution.suggestedDate,
    )
    : null;

  // A date window or contradictory compound date is not an availability query
  // and must never fall through to time selection using stale offers.
  if (session && unresolvedDateReply) {
    const next = {
      ...session,
      status: 'choosing_date' as const,
      selected_date: null,
      staff_id: null,
      offered_times: [],
      selected_starts_at: null,
      last_interpretation_intent: interpretation.intent,
      last_error_code: null,
    };
    session = await saveBookingDecision(client, session, {
      next, operation: 'none', reply: unresolvedDateReply, createSession: false, handoff: false, errorCode: null,
    }, context.inboundMessageId, context.runId);
    const sent = await input.sendReply(unresolvedDateReply);
    return { handled: true as const, sent, handoff: false, session, handoffReason: null };
  }

  if (!session) {
    session = await createBookingSession(client, initialSessionValues({
      businessId: context.businessId,
      conversationId: context.conversationId,
      runId: context.runId,
      inboundMessageId: context.inboundMessageId,
      status: initialStatus(serviceId, selectedDate),
      intent: interpretation.intent,
      serviceId,
      selectedDate,
      expiresAt: new Date(Date.parse(nowIso) + SESSION_TTL_MS).toISOString(),
    }));
    if (!serviceId) {
      const sent = await input.sendReply(bookingReplies.askService);
      return { handled: true as const, sent, handoff: false };
    }
    const professionals = await compatibleProfessionals(client, context.businessId, serviceId);
    const serviceName = services.find(({ id }) => id === serviceId)?.name ?? null;
    if (!professionals.length) {
      const next = {
        ...session,
        status: 'choosing_service' as const,
        staff_id: null,
        staff_preference: 'unasked' as const,
        offered_professionals: [],
        selected_date: null,
        offered_times: [],
        selected_starts_at: null,
      };
      const saved = await saveBookingDecision(client, session, {
        next, operation: 'none', reply: bookingReplies.askService,
        createSession: false, handoff: false, errorCode: 'SERVICE_NOT_RESOLVED',
      }, context.inboundMessageId, context.runId);
      const sent = await input.sendReply(bookingReplies.askService);
      return { handled: true as const, sent, handoff: false, session: saved, handoffReason: null };
    }
    const professionalResolution = await professionalGateForReference({
      client,
      businessId: context.businessId,
      session,
      professionals,
      staffReference: interpretation.staff_reference,
      serviceName,
    });
    const gated = professionalResolution.gate;
    if (gated.status === 'choosing_professional') {
      const saved = await saveBookingDecision(client, session, {
        next: gated, operation: 'none', reply: professionalResolution.reply ?? professionalReply(professionals),
        createSession: false, handoff: false, errorCode: null,
      }, context.inboundMessageId, context.runId);
      const sent = await input.sendReply(professionalResolution.reply ?? professionalReply(professionals));
      return { handled: true as const, sent, handoff: false, session: saved, handoffReason: null };
    }
    if (gated !== session) {
      session = await saveBookingDecision(client, session, {
        next: gated, operation: 'none', reply: '', createSession: false, handoff: false, errorCode: null,
      }, context.inboundMessageId, context.runId);
    }
    if (!selectedDate) {
      const sent = await input.sendReply(unresolvedDateReply ?? askDateForService(serviceName, false));
      return { handled: true as const, sent, handoff: false, session, handoffReason: null };
    }
    const availabilityResult = await availability(client, context, session);
    const options = availabilityResult.options;
    const requestedTime = normalizeRequestedTime(input.text, interpretation);
    const selected = requestedTime ? optionForRequestedTime(availabilityResult.allOptions, requestedTime) : null;
    const persistedOptions = selected
      ? persistExactOption(options, selected)
      : requestedTime
      ? nearbyAvailabilityOptions(availabilityResult.allOptions, requestedTime, options)
      : options;
    const next = {
      ...session,
      offered_times: persistedOptions,
      selected_starts_at: selected?.starts_at ?? null,
      staff_id: selected?.staff_id ?? session.staff_id,
      selected_date: availabilityResult.allOptions.length ? selectedDate : null,
      status: selected
        ? 'awaiting_confirmation' as const
        : availabilityResult.allOptions.length ? 'choosing_time' as const : 'choosing_date' as const,
      availability_checked_at: nowIso,
      last_interpretation_intent: interpretation.intent,
    };
    const reply = selected
      ? selectionReply(customerDateLabel, selected.label, selected.staff_display_name)
      : requestedTime
      ? unavailableTimeReply(persistedOptions)
      : options.length
      ? bookingReplies.askTime
      : bookingReplies.noAvailability;
    const saved = await saveBookingDecision(client, session, {
      next,
      operation: 'none',
      reply,
      createSession: false,
      handoff: false,
      errorCode: availabilityResult.allOptions.length ? null : 'AVAILABILITY_UNAVAILABLE',
    }, context.inboundMessageId, context.runId);
    const sent = await input.sendReply(reply);
    return { handled: true as const, sent, handoff: false, session: saved, handoffReason: null };
  }

  const awaitingConfirmation = session.status === 'awaiting_confirmation';
  const allowBareHour = !dateExplicit && (session.status === 'choosing_time' || awaitingConfirmation);
  // Raw text is deterministic and wins over a model field that might mistake
  // a time phrase (for example, "mejor a las nueve") for a staff reference.
  const rawTimeInterpretation = { ...interpretation, time_expression: null };
  const selectedOption = dateExplicit ? null
    : resolveTimeExpression(input.text, rawTimeInterpretation, session)
      ?? resolveTimeExpression(input.text, interpretation, session);
  const requestedTime = dateExplicit ? null
    : normalizeRequestedTime(input.text, rawTimeInterpretation, allowBareHour)
      ?? normalizeRequestedTime(input.text, interpretation, allowBareHour);
  let exactRequestedOption: OfferedTime | null = null;
  let exactAvailabilityOptions: OfferedTime[] | undefined;
  const confirmationExplicit = awaitingConfirmation && isAffirmative(input.text, interpretation);
  const rejectionExplicit = awaitingConfirmation
    && (interpretation.intent === 'reject' || /^(?:no|cancelar|cancela|dejalo|déjalo)[!.\s]*$/i.test(input.text));
  const requestedStaffId = resolveStaffReference(interpretation.staff_reference, session)
    ?? resolveStaffReference(input.text, session)
    ?? resolveStaffReferenceInText(input.text, session?.offered_professionals ?? []);
  const rawHasProfessionalReference = hasExplicitStaffReference(input.text);
  const requestedStaffReference = rawHasProfessionalReference
    ? extractStaffReference(input.text)
    : requestedStaffId
    ? extractStaffReference(input.text)
    : extractStaffReference(interpretation.staff_reference);
  const timeExplicit = Boolean(selectedOption || requestedTime);
  let effectiveInterpretation = interpretation;
  let effectiveStaffId = requestedStaffId;
  if (awaitingConfirmation && confirmationExplicit) {
    effectiveInterpretation = { ...interpretation, intent: 'confirm', confirmation: true, staff_reference: null };
    effectiveStaffId = null;
  } else if (awaitingConfirmation && rejectionExplicit) {
    effectiveInterpretation = { ...interpretation, intent: 'reject', confirmation: false, staff_reference: null };
    effectiveStaffId = null;
  } else if (awaitingConfirmation && timeExplicit) {
    effectiveInterpretation = { ...interpretation, intent: 'choose_time', staff_reference: null };
  } else if (awaitingConfirmation && dateExplicit) {
    effectiveInterpretation = { ...interpretation, intent: 'choose_date', staff_reference: null };
    effectiveStaffId = null;
  }

  // "Sigo con FRAN" after an incompatible-professional question restores the
  // existing provisional choice by revalidating it, not by asking for a time
  // again. The exact staff+instant pair remains server-authoritative.
  if (awaitingConfirmation && !confirmationExplicit && !rejectionExplicit && !timeExplicit && !dateExplicit
    && effectiveStaffId && effectiveStaffId === session.staff_id) {
    const selected = selectedOffer(session);
    const fresh = await availability(client, context, session);
    if (selected && optionStillOffered(selected, fresh.allOptions)) {
      const next = {
        ...session,
        offered_times: persistExactOption(fresh.options, selected),
        last_interpretation_intent: effectiveInterpretation.intent,
        last_error_code: null,
      };
      const saved = await saveBookingDecision(client, session, {
        next, operation: 'none', reply: selectionReply(customerDateLabel, selected.label, selected.staff_display_name),
        createSession: false, handoff: false, errorCode: null,
      }, context.inboundMessageId, context.runId);
      const sent = await input.sendReply(selectionReply(customerDateLabel, selected.label, selected.staff_display_name));
      return { handled: true as const, sent, handoff: false, session: saved, handoffReason: null };
    }
  }

  // A named professional is a correction even when the same sentence also
  // contains a date. Resolve it against the active business catalog only to
  // explain incompatibility; compatibility itself remains server-authoritative
  // through the session's compatible-professional catalog.
  if (!confirmationExplicit && !rejectionExplicit
    && rawHasProfessionalReference && !effectiveStaffId) {
    const activeStaff = await listActiveBusinessStaff(client, context.businessId);
    const activeStaffId = resolveStaffReferenceInText(input.text, activeStaff)
      ?? resolveStaffFromCatalog(requestedStaffReference, activeStaff);
    const compatibleProfessionals = session.offered_professionals ?? [];
    const serviceName = services.find(({ id }) => id === session!.service_id)?.name ?? null;
    const next = {
      ...session,
      last_interpretation_intent: effectiveInterpretation.intent,
      last_error_code: null,
    };
    const activeStaffName = activeStaff.find((staff) => staff.staff_id === activeStaffId)?.staff_display_name
      ?? requestedStaffReference
      ?? 'Ese profesional';
    const reply = activeStaffId
      ? incompatibleProfessionalReply(activeStaffName, serviceName, compatibleProfessionals)
      : clarifyProfessionalReply();
    const saved = await saveBookingDecision(client, session, {
      next, operation: 'none', reply, createSession: false, handoff: false, errorCode: null,
    }, context.inboundMessageId, context.runId);
    const sent = await input.sendReply(reply);
    return { handled: true as const, sent, handoff: false, session: saved, handoffReason: null };
  }
  const professionalChanged = Boolean(effectiveStaffId && effectiveStaffId !== session.staff_id);
  if (!dateExplicit && requestedTime && (!selectedOption || professionalChanged)) {
    // Resolve a requested professional before checking the requested time. A
    // combined correction such as "con Fran a las 13" must never reuse the
    // old professional's availability.
    const availabilitySession = professionalChanged
      ? { ...session, staff_id: effectiveStaffId, staff_preference: 'selected' as const }
      : session;
    const exactAvailability = await availability(client, context, availabilitySession);
    exactRequestedOption = optionForRequestedTime(exactAvailability.allOptions, requestedTime);
    const timeOptions = exactRequestedOption
      ? persistExactOption(exactAvailability.options, exactRequestedOption)
      : nearbyAvailabilityOptions(exactAvailability.allOptions, requestedTime, exactAvailability.options);
    if (professionalChanged) {
      exactAvailabilityOptions = timeOptions;
    } else {
      session = { ...session, offered_times: timeOptions };
    }
  }
  const finalSelectedOption = professionalChanged ? exactRequestedOption : selectedOption ?? exactRequestedOption;
  const resolved: ResolvedBookingInput = {
    serviceId,
    selectedDate,
    selectedOption: finalSelectedOption,
    requestedTime,
    serviceExplicit,
    dateExplicit,
    staffId: effectiveStaffId,
    staffExplicit: Boolean(effectiveStaffId),
    availabilityOptions: exactAvailabilityOptions,
    expired: Date.parse(session.expires_at) <= Date.parse(nowIso),
  };
  let decision = reduceBookingState({
    session,
    interpretation: effectiveInterpretation,
    rawText: input.text,
    resolved,
    dateLabel: customerDateLabel,
    nowIso,
  });

  if (decision.next?.status === 'choosing_date' && decision.reply === bookingReplies.askDate) {
    decision = {
      ...decision,
      reply: isGreeting(input.text)
        ? await contextualDatePrompt(client, context.businessId, decision.next)
        : bookingReplies.clarifyDate,
    };
  }

  if (decision.operation === 'query_availability') {
    const availabilityResult = await availability(client, context, decision.next ?? session);
    const options = availabilityResult.options;
    decision = reduceBookingState({
      session: decision.next ?? session,
      interpretation: effectiveInterpretation,
      rawText: input.text,
      resolved: { ...resolved, availabilityOptions: options },
      dateLabel: customerDateLabel,
      nowIso,
    });
    if (!availabilityResult.allOptions.length) {
      const chosenProfessional = staffExplicit
        ? (session.offered_professionals ?? []).find((staff) => staff.staff_id === effectiveStaffId)?.staff_display_name
        : null;
      decision = {
        ...decision,
        reply: chosenProfessional
          ? `No encuentro huecos con ${chosenProfessional} para ese día. ¿Quieres que pruebe otra fecha?`
          : bookingReplies.noAvailability,
      };
    } else if (decision.next?.status === 'choosing_time') {
      decision = { ...decision, reply: bookingReplies.askTime };
    }
  }

  if (decision.operation === 'revalidate_selected') {
    const current = decision.next ?? session;
    const selected = current.offered_times.find((option) => option.starts_at === current.selected_starts_at);
    const fresh = await availability(client, context, current);
    decision = reduceBookingState({
      session: current,
      interpretation: effectiveInterpretation,
      rawText: input.text,
      resolved: {
        ...resolved,
        availabilityOptions: fresh.options,
        revalidation: selected && optionStillOffered(selected, fresh.allOptions) ? 'available' : 'unavailable',
      },
      dateLabel: customerDateLabel,
      nowIso,
    });
  }

  if (decision.operation === 'confirm_booking') {
    try {
      const confirmed = await confirmBookingSession(client, {
        businessId: context.businessId,
        conversationId: context.conversationId,
        sessionId: session.id,
        inboundMessageId: context.inboundMessageId,
        expectedVersion: session.version,
      });
      if (confirmed.outcome === 'unavailable') {
        const options = confirmed.offered_times ?? [];
        const reply = options.length
          ? `${bookingReplies.unavailable} ${availabilityReply(formatCustomerDate(session.selected_date ?? temporal.localDate, temporal.timezone), options)}`
          : bookingReplies.noAvailability;
        const sent = await input.sendReply(reply);
        return { handled: true as const, sent, handoff: false };
      }
      const reply = confirmationReply(confirmed, temporal.timezone);
      const sent = await input.sendReply(reply);
      if (sent.messageId) {
        await recordBookingConfirmationResponse(client, {
          businessId: context.businessId,
          sessionId: session.id,
          inboundMessageId: context.inboundMessageId,
          responseMessageId: sent.messageId,
        });
      }
      return { handled: true as const, sent, handoff: false };
    } catch {
      await client.from('beauty_conversations').update({
        needs_attention: true,
        attention_reason: 'BOOKING_CONFIRMATION_FAILED',
      }).eq('id', context.conversationId).eq('business_id', context.businessId);
      const sent = await input.sendReply(
        'No he podido confirmar la cita ahora mismo. Una persona del negocio la revisará contigo.',
      );
      return { handled: true as const, sent, handoff: false };
    }
  }

  const saved = decision.next
    ? await saveBookingDecision(client, session, decision, context.inboundMessageId, context.runId)
    : session;
  const reply = decision.reply || (
    saved.offered_times.length ? availabilityReply(customerDateLabel, saved.offered_times) : bookingReplies.clarify
  );
  const sent = await input.sendReply(reply);
  return {
    handled: true as const,
    sent,
    handoff: decision.handoff,
    session: saved,
    handoffReason: saved.handoff_reason,
  };
}
