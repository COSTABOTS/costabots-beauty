import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { askDateForService, bookingReplies, availabilityReply } from './bookingReplies.ts';
import { interpretBookingMessage } from './bookingInterpreter.ts';
import {
  createBookingSession,
  initialSessionValues,
  loadActiveBookingSession,
  saveBookingDecision,
} from './bookingSessionRepository.ts';
import {
  deterministicDateOverride,
  interpretBookingDeterministically,
  normalizeRequestedTime,
  optionStillOffered,
  resolveRequestedDate,
  resolveServiceReference,
  resolveTimeExpression,
} from './bookingResolvers.ts';
import { reduceBookingState } from './bookingStateMachine.ts';
import { getAvailability, listServices } from './tools.ts';
import type { TemporalContext } from './dateResolution.ts';
import type {
  BookingDecision,
  BookingSession,
  OfferedTime,
  ResolvedBookingInput,
} from './bookingTypes.ts';

const MIN_INTERPRETATION_CONFIDENCE = 0.55;
const SESSION_TTL_MS = 30 * 60 * 1000;

function isGreeting(text: string) {
  const normalized = text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  return /^(hola|buenas|buenos dias|buenas tardes|buenas noches)\b/.test(normalized);
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
    return askDateForService(services.find(({ id }) => id === session.service_id)?.name ?? null);
  } catch {
    return bookingReplies.askDate;
  }
}

function offeredOptions(value: Record<string, unknown>): OfferedTime[] {
  const rows = Array.isArray(value.slots) ? value.slots as Array<Record<string, unknown>> : [];
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const option = {
      starts_at: String(row.startsAt ?? ''),
      staff_id: String(row.staffId ?? ''),
      label: String(row.label ?? ''),
    };
    const key = `${option.starts_at}|${option.staff_id}`;
    if (!option.starts_at || !option.staff_id || !/^\d{2}:\d{2}$/.test(option.label) || seen.has(key)) return [];
    seen.add(key);
    return [option];
  }).slice(0, 5);
}

async function availability(
  client: SupabaseClient,
  context: FlowContext,
  session: BookingSession,
) {
  if (!session.service_id || !session.selected_date) return [];
  const result = await getAvailability(client, context.businessId, {
    service_id: session.service_id,
    date: session.selected_date,
    staff_id: session.staff_id,
  });
  return offeredOptions(result);
}

function initialStatus(serviceId: string | null, date: string | null) {
  if (!serviceId) return 'choosing_service' as const;
  if (!date) return 'choosing_date' as const;
  return 'choosing_time' as const;
}

export async function processBookingFlow(input: {
  client: SupabaseClient;
  context: FlowContext;
  text: string;
  temporal: TemporalContext;
  nowIso: string;
  sendReply: (text: string) => Promise<{ discarded: boolean; messageId?: string; reason?: string }>;
}) {
  const { client, context, temporal, nowIso } = input;
  let session = await loadActiveBookingSession(client, context.businessId, context.conversationId);
  const serviceResult = await listServices(client, context.businessId);
  const services = (serviceResult.services ?? []) as Array<{ id: string; name: string }>;
  const deterministicDate = deterministicDateOverride(session?.status ?? null, input.text, temporal);
  let interpretation = deterministicDate?.interpretation
    ?? interpretBookingDeterministically(input.text, session?.status ?? null, services, temporal);
  if (!interpretation) try {
    interpretation = await interpretBookingMessage({
      text: input.text,
      status: session?.status ?? null,
      temporal,
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

  if (!session && interpretation.intent === 'ask_information') return { handled: false as const };
  if (!session && interpretation.intent === 'unknown') {
    const sent = await input.sendReply(bookingReplies.greeting);
    return { handled: true as const, sent, handoff: false };
  }

  const serviceExplicit = Boolean(interpretation.service_reference?.trim());
  const requestedServiceId = resolveServiceReference(interpretation.service_reference, services);

  // Selecting a service is a complete turn. Do not reuse the same text as a
  // date expression or availability request, even when model confidence is low.
  if (session?.status === 'choosing_service' && serviceExplicit && requestedServiceId) {
    const serviceName = services.find(({ id }) => id === requestedServiceId)?.name ?? null;
    const reply = askDateForService(serviceName, false);
    const next = {
      ...session,
      status: 'choosing_date' as const,
      service_id: requestedServiceId,
      staff_id: null,
      selected_date: null,
      offered_times: [],
      selected_starts_at: null,
      last_interpretation_intent: 'choose_service' as const,
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
    const reply = session
      ? session.status === 'choosing_date' ? bookingReplies.clarifyDate : bookingReplies.lowConfidence
      : bookingReplies.lowConfidence;
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
    if (!selectedDate) {
      const serviceName = services.find(({ id }) => id === serviceId)?.name ?? null;
      const sent = await input.sendReply(askDateForService(serviceName));
      return { handled: true as const, sent, handoff: false };
    }
    const options = await availability(client, context, session);
    const requestedTime = normalizeRequestedTime(input.text, interpretation);
    const selected = requestedTime ? options.find(({ label }) => label === requestedTime) : null;
    const next = {
      ...session,
      offered_times: options,
      selected_starts_at: selected?.starts_at ?? null,
      staff_id: selected?.staff_id ?? null,
      selected_date: options.length ? selectedDate : null,
      status: selected
        ? 'awaiting_confirmation' as const
        : options.length ? 'choosing_time' as const : 'choosing_date' as const,
      availability_checked_at: nowIso,
      last_interpretation_intent: interpretation.intent,
    };
    const reply = selected
      ? `Has elegido ${selectedDate} a las ${selected.label}. ¿Quieres que una persona del negocio confirme la cita?`
      : options.length
      ? availabilityReply(selectedDate, options)
      : bookingReplies.noAvailability;
    const saved = await saveBookingDecision(client, session, {
      next,
      operation: 'none',
      reply,
      createSession: false,
      handoff: false,
      errorCode: options.length ? null : 'AVAILABILITY_UNAVAILABLE',
    }, context.inboundMessageId, context.runId);
    const sent = await input.sendReply(reply);
    return { handled: true as const, sent, handoff: false, session: saved, handoffReason: null };
  }

  const selectedOption = resolveTimeExpression(input.text, interpretation, session);
  const requestedTime = normalizeRequestedTime(input.text, interpretation);
  const resolved: ResolvedBookingInput = {
    serviceId,
    selectedDate,
    selectedOption,
    requestedTime,
    serviceExplicit,
    dateExplicit,
    expired: Date.parse(session.expires_at) <= Date.parse(nowIso),
  };
  let decision = reduceBookingState({
    session,
    interpretation,
    rawText: input.text,
    resolved,
    dateLabel: selectedDate ?? 'ese día',
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
    const options = await availability(client, context, decision.next ?? session);
    decision = reduceBookingState({
      session: decision.next ?? session,
      interpretation,
      rawText: input.text,
      resolved: { ...resolved, availabilityOptions: options },
      dateLabel: selectedDate ?? 'ese día',
      nowIso,
    });
    if (!options.length) decision = { ...decision, reply: bookingReplies.noAvailability };
  }

  if (decision.operation === 'revalidate_selected') {
    const current = decision.next ?? session;
    const selected = current.offered_times.find((option) => option.starts_at === current.selected_starts_at);
    const fresh = await availability(client, context, current);
    decision = reduceBookingState({
      session: current,
      interpretation,
      rawText: input.text,
      resolved: {
        ...resolved,
        availabilityOptions: fresh,
        revalidation: selected && optionStillOffered(selected, fresh) ? 'available' : 'unavailable',
      },
      dateLabel: selectedDate ?? 'ese día',
      nowIso,
    });
  }

  const saved = decision.next
    ? await saveBookingDecision(client, session, decision, context.inboundMessageId, context.runId)
    : session;
  const reply = decision.reply || (
    saved.offered_times.length ? availabilityReply(selectedDate ?? 'ese día', saved.offered_times) : bookingReplies.clarify
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
