import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { parseBookingInterpretation } from './bookingInterpreter.ts';
import { askDateForService } from './bookingReplies.ts';
import {
  deterministicDateOverride,
  interpretBookingDeterministically,
  normalizeRequestedTime,
  resolveRequestedDate,
  resolveTimeExpression,
} from './bookingResolvers.ts';
import { reduceBookingState } from './bookingStateMachine.ts';
import { buildTemporalContext } from './dateResolution.ts';
import type { BookingInterpretation, BookingSession, OfferedTime } from './bookingTypes.ts';

const options: OfferedTime[] = [
  { starts_at: '2026-08-03T09:00:00+02:00', staff_id: '11111111-1111-4111-8111-111111111111', label: '09:00' },
  { starts_at: '2026-08-03T10:00:00+02:00', staff_id: '11111111-1111-4111-8111-111111111111', label: '10:00' },
];
const interpretation: BookingInterpretation = {
  intent: 'choose_time',
  service_reference: null,
  date_expression: null,
  time_expression: null,
  option_reference: null,
  confirmation: null,
  wants_human: false,
  confidence: 1,
};
const session: BookingSession = {
  id: '22222222-2222-4222-8222-222222222222',
  business_id: '33333333-3333-4333-8333-333333333333',
  conversation_id: '44444444-4444-4444-8444-444444444444',
  status: 'choosing_time',
  service_id: '55555555-5555-4555-8555-555555555555',
  staff_id: null,
  selected_date: '2026-08-03',
  offered_times: options,
  selected_starts_at: null,
  source_ai_run_id: null,
  last_processed_inbound_message_id: null,
  last_response_message_id: null,
  last_interpretation_intent: null,
  last_error_code: null,
  handoff_reason: null,
  version: 1,
  availability_checked_at: '2026-08-02T10:00:00Z',
  expires_at: '2026-08-02T11:00:00Z',
};

Deno.test('strict interpretation rejects extra fields and invalid confidence', () => {
  assertThrows(() => parseBookingInterpretation({ ...interpretation, extra: true }));
  assertThrows(() => parseBookingInterpretation({ ...interpretation, confidence: 2 }));
});

Deno.test('choosing date deterministically recognizes relative dates and bare weekdays', () => {
  const temporal = buildTemporalContext(new Date('2026-07-31T08:00:00Z'), 'Europe/Madrid');
  const cases = [
    ['Lunes', '2026-08-03'],
    ['el lunes', '2026-08-03'],
    ['este lunes', '2026-08-03'],
    ['El martes', '2026-08-04'],
    ['Mañana', '2026-08-01'],
    ['pasado mañana', '2026-08-02'],
  ];
  for (const [text, expected] of cases) {
    const result = deterministicDateOverride('choosing_date', text, temporal);
    assertEquals(result?.resolution.isoDate, expected);
    assertEquals(result?.interpretation.intent, 'choose_date');
    assertEquals(result?.interpretation.confidence, 1);
  }
  assertEquals(deterministicDateOverride('choosing_date', 'Nañana', temporal)?.resolution.isoDate, '2026-08-01');
  assertEquals(deterministicDateOverride('choosing_date', 'El día 1', temporal)?.resolution.isoDate, '2026-08-01');
  assertEquals(deterministicDateOverride('choosing_date', '5 de agosto', temporal)?.resolution.isoDate, '2026-08-05');
});

Deno.test('raw deterministic date wins over empty, unknown or low-confidence Gemini output', () => {
  const temporal = buildTemporalContext(new Date('2026-07-31T08:00:00Z'), 'Europe/Madrid');
  for (const candidate of [
    { ...interpretation, intent: 'unknown' as const, confidence: 1, date_expression: null },
    { ...interpretation, intent: 'unknown' as const, confidence: 0.1, date_expression: '' },
  ]) {
    const result = resolveRequestedDate('Mañana', candidate, temporal);
    assertEquals(result.status, 'resolved');
    assertEquals(result.isoDate, '2026-08-01');
  }
});

Deno.test('greeting while choosing date preserves service and has a contextual prompt', () => {
  const choosingDate = {
    ...session,
    status: 'choosing_date' as const,
    selected_date: null,
    offered_times: [],
  };
  const result = reduceBookingState({
    session: choosingDate,
    interpretation: { ...interpretation, intent: 'unknown' },
    rawText: 'Hola',
    resolved: {
      serviceId: choosingDate.service_id,
      selectedDate: null,
      selectedOption: null,
      expired: false,
    },
    dateLabel: 'ese día',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.next?.service_id, choosingDate.service_id);
  assertEquals(result.next?.status, 'choosing_date');
  assertEquals(askDateForService('corte'), 'Hola. ¿Qué día te vendría bien para el corte?');
  assertEquals(askDateForService('Corte', false), '¿Qué día te vendría bien para el corte?');
});

Deno.test('repeating the selected service does not restart or replace the active session', () => {
  const choosingDate = {
    ...session,
    status: 'choosing_date' as const,
    selected_date: null,
    offered_times: [],
  };
  const result = reduceBookingState({
    session: choosingDate,
    interpretation: { ...interpretation, intent: 'choose_service', service_reference: 'corte' },
    rawText: 'Corte',
    resolved: {
      serviceId: choosingDate.service_id,
      selectedDate: null,
      selectedOption: null,
      serviceExplicit: true,
      expired: false,
    },
    dateLabel: 'ese día',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.createSession, false);
  assertEquals(result.next?.id, choosingDate.id);
  assertEquals(result.next?.service_id, choosingDate.service_id);
  assertEquals(result.next?.status, 'choosing_date');
});

Deno.test('valid date requests availability and zero slots always returns a response', () => {
  const choosingDate = {
    ...session,
    status: 'choosing_date' as const,
    selected_date: null,
    offered_times: [],
  };
  const first = reduceBookingState({
    session: choosingDate,
    interpretation: { ...interpretation, intent: 'choose_date', date_expression: 'lunes' },
    rawText: 'Lunes',
    resolved: {
      serviceId: choosingDate.service_id,
      selectedDate: '2026-08-03',
      selectedOption: null,
      dateExplicit: true,
      expired: false,
    },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(first.operation, 'query_availability');

  const second = reduceBookingState({
    session: first.next,
    interpretation: { ...interpretation, intent: 'choose_date', date_expression: 'lunes' },
    rawText: 'Lunes',
    resolved: {
      serviceId: choosingDate.service_id,
      selectedDate: '2026-08-03',
      selectedOption: null,
      dateExplicit: true,
      availabilityOptions: [],
      expired: false,
    },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:01:01Z',
  });
  assert(second.reply.length > 0);
  assert(second.reply.includes('No encuentro huecos'));
  assertEquals(second.next?.status, 'choosing_date');
  assertEquals(second.next?.service_id, choosingDate.service_id);
  assertEquals(second.next?.selected_date, null);
  assertEquals(second.handoff, false);
});

Deno.test('A las 10 and normalized variants select only a persisted offer', () => {
  assertEquals(resolveTimeExpression('A las 10', interpretation, session), options[1]);
  assertEquals(resolveTimeExpression('10:00', interpretation, session), options[1]);
  assertEquals(resolveTimeExpression('11:00', interpretation, session), null);
});

Deno.test('option references select the persisted first, last and current option', () => {
  assertEquals(resolveTimeExpression('la primera', { ...interpretation, option_reference: 'first' }, session), options[0]);
  assertEquals(resolveTimeExpression('la última', { ...interpretation, option_reference: 'last' }, session), options[1]);
  assertEquals(
    resolveTimeExpression('esa', { ...interpretation, option_reference: 'that' }, {
      ...session,
      selected_starts_at: options[0].starts_at,
    }),
    options[0],
  );
});

Deno.test('yes cannot confirm while choosing time', () => {
  const result = reduceBookingState({
    session,
    interpretation: { ...interpretation, intent: 'confirm', confirmation: true },
    rawText: 'sí',
    resolved: { serviceId: session.service_id, selectedDate: session.selected_date, selectedOption: null, expired: false },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.next?.status, 'choosing_time');
  assert(result.reply.includes('elijas'));
});

Deno.test('selecting an offered time moves to awaiting confirmation without claiming a booking', () => {
  const result = reduceBookingState({
    session,
    interpretation,
    rawText: 'A las 10',
    resolved: { serviceId: session.service_id, selectedDate: session.selected_date, selectedOption: options[1], expired: false },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.next?.status, 'awaiting_confirmation');
  assertEquals(result.next?.selected_starts_at, options[1].starts_at);
  assert(!result.reply.toLowerCase().includes('confirmada'));
});

Deno.test('date and service changes clear stale structured offers', () => {
  const date = reduceBookingState({
    session,
    interpretation: { ...interpretation, intent: 'change_selection', date_expression: 'mañana' },
    rawText: 'mejor mañana',
    resolved: {
      serviceId: session.service_id,
      selectedDate: '2026-08-04',
      selectedOption: null,
      dateExplicit: true,
      expired: false,
    },
    dateLabel: 'mañana',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(date.next?.offered_times, []);
  assertEquals(date.operation, 'query_availability');

  const service = reduceBookingState({
    session,
    interpretation: { ...interpretation, intent: 'change_selection', service_reference: 'tinte' },
    rawText: 'mejor tinte',
    resolved: {
      serviceId: '66666666-6666-4666-8666-666666666666',
      selectedDate: session.selected_date,
      selectedOption: null,
      serviceExplicit: true,
      expired: false,
    },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(service.next?.selected_date, null);
  assertEquals(service.next?.offered_times, []);
});

Deno.test('choosing time distinguishes clarification from a valid unavailable time', () => {
  for (const rawText of ['No veo nada', 'Hola']) {
    const result = reduceBookingState({
      session,
      interpretation: { ...interpretation, intent: 'unknown' },
      rawText,
      resolved: {
        serviceId: session.service_id,
        selectedDate: session.selected_date,
        selectedOption: null,
        requestedTime: normalizeRequestedTime(rawText, interpretation),
        expired: false,
      },
      dateLabel: 'el lunes',
      nowIso: '2026-08-02T10:01:00Z',
    });
    assertEquals(result.errorCode, null);
    assert(!result.reply.startsWith('Esa hora'));
  }

  const unavailable = reduceBookingState({
    session,
    interpretation,
    rawText: 'Las 12',
    resolved: {
      serviceId: session.service_id,
      selectedDate: session.selected_date,
      selectedOption: null,
      requestedTime: '12:00',
      expired: false,
    },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(unavailable.errorCode, 'TIME_NOT_OFFERED');
  assert(unavailable.reply.includes('09:00'));
  assert(unavailable.reply.includes('10:00'));
});

Deno.test('empty offers never claim that options were already shown', () => {
  const result = reduceBookingState({
    session: { ...session, offered_times: [] },
    interpretation,
    rawText: 'Las 12',
    resolved: {
      serviceId: session.service_id,
      selectedDate: session.selected_date,
      selectedOption: null,
      requestedTime: '12:00',
      expired: false,
    },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.errorCode, 'TIME_NOT_OFFERED');
  assert(!result.reply.includes('horarios que te he mostrado'));
  assert(result.reply.includes('otra fecha'));
});

Deno.test('explicit date in choosing time clears stale offers and refreshes availability', () => {
  const result = reduceBookingState({
    session,
    interpretation: { ...interpretation, intent: 'choose_date', date_expression: 'el lunes' },
    rawText: 'El lunes',
    resolved: {
      serviceId: session.service_id,
      selectedDate: '2026-08-03',
      selectedOption: null,
      dateExplicit: true,
      expired: false,
    },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.operation, 'query_availability');
  assertEquals(result.next?.selected_date, '2026-08-03');
  assertEquals(result.next?.offered_times, []);
  assertEquals(result.next?.selected_starts_at, null);
});

Deno.test('compound service date and time refreshes context then selects only a fresh offer', () => {
  const changedService = '66666666-6666-4666-8666-666666666666';
  const first = reduceBookingState({
    session,
    interpretation: {
      ...interpretation,
      intent: 'choose_time',
      service_reference: 'corte',
      date_expression: 'el lunes',
      time_expression: '9',
    },
    rawText: 'Corte el lunes a las 9',
    resolved: {
      serviceId: changedService,
      selectedDate: '2026-08-03',
      selectedOption: null,
      requestedTime: '09:00',
      serviceExplicit: true,
      dateExplicit: true,
      expired: false,
    },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(first.operation, 'query_availability');
  assertEquals(first.next?.offered_times, []);

  const second = reduceBookingState({
    session: first.next,
    interpretation: {
      ...interpretation,
      intent: 'choose_time',
      service_reference: 'corte',
      date_expression: 'el lunes',
      time_expression: '9',
    },
    rawText: 'Corte el lunes a las 9',
    resolved: {
      serviceId: changedService,
      selectedDate: '2026-08-03',
      selectedOption: null,
      requestedTime: '09:00',
      serviceExplicit: true,
      dateExplicit: true,
      availabilityOptions: options,
      expired: false,
    },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:01:01Z',
  });
  assertEquals(second.next?.status, 'awaiting_confirmation');
  assertEquals(second.next?.selected_starts_at, options[0].starts_at);
});

Deno.test('expired options are never reused', () => {
  const result = reduceBookingState({
    session,
    interpretation,
    rawText: '10',
    resolved: { serviceId: session.service_id, selectedDate: session.selected_date, selectedOption: options[1], expired: true },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T11:01:00Z',
  });
  assertEquals(result.next?.status, 'expired');
  assertEquals(result.next?.offered_times, []);
});

Deno.test('availability change clears selection and does not hand off', () => {
  const awaiting = { ...session, status: 'awaiting_confirmation' as const, selected_starts_at: options[0].starts_at, staff_id: options[0].staff_id };
  const result = reduceBookingState({
    session: awaiting,
    interpretation: { ...interpretation, intent: 'confirm', confirmation: true },
    rawText: 'sí',
    resolved: {
      serviceId: session.service_id,
      selectedDate: session.selected_date,
      selectedOption: options[0],
      availabilityOptions: [options[1]],
      revalidation: 'unavailable',
      expired: false,
    },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:02:00Z',
  });
  assertEquals(result.next?.status, 'choosing_time');
  assertEquals(result.next?.selected_starts_at, null);
  assertEquals(result.handoff, false);
});

Deno.test('available confirmation produces controlled reply-before-handoff decision', () => {
  const awaiting = { ...session, status: 'awaiting_confirmation' as const, selected_starts_at: options[0].starts_at, staff_id: options[0].staff_id };
  const result = reduceBookingState({
    session: awaiting,
    interpretation: { ...interpretation, intent: 'confirm', confirmation: true },
    rawText: 'sí, resérvala',
    resolved: {
      serviceId: session.service_id,
      selectedDate: session.selected_date,
      selectedOption: options[0],
      availabilityOptions: options,
      revalidation: 'available',
      expired: false,
    },
    dateLabel: 'el lunes',
    nowIso: '2026-08-02T10:02:00Z',
  });
  assertEquals(result.operation, 'send_handoff');
  assertEquals(result.handoff, true);
  assert(result.reply.includes('todavía no está confirmada'));
  assertEquals(result.next?.status, 'awaiting_confirmation');
});

Deno.test('deterministic coordinator extracts compound service date and time', () => {
  const temporal = buildTemporalContext(new Date('2026-07-31T08:00:00Z'), 'Europe/Madrid');
  const result = interpretBookingDeterministically(
    'Corte el lunes a las 9',
    null,
    [{ id: session.service_id!, name: 'Corte' }],
    temporal,
  );
  assertEquals(result?.intent, 'choose_service');
  assertEquals(result?.service_reference, 'Corte');
  assertEquals(resolveRequestedDate('Corte el lunes a las 9', result!, temporal).isoDate, '2026-08-03');
  assertEquals(normalizeRequestedTime('Corte el lunes a las 9', result!), '09:00');
});

Deno.test('natural hour words and afternoon expressions normalize deterministically', () => {
  assertEquals(normalizeRequestedTime('a las nueve', interpretation), '09:00');
  assertEquals(normalizeRequestedTime('las 10', interpretation), '10:00');
  assertEquals(normalizeRequestedTime('5 de la tarde', interpretation), '17:00');
});

Deno.test('greetings and clarification do not masquerade as a time', () => {
  assertEquals(normalizeRequestedTime('Hola', interpretation), null);
  assertEquals(normalizeRequestedTime('No veo nada', interpretation), null);
});

Deno.test('affirmative option confirmation is deterministic', () => {
  const result = interpretBookingDeterministically(
    'Sí, esa',
    'awaiting_confirmation',
    [],
    buildTemporalContext(new Date('2026-07-31T08:00:00Z'), 'Europe/Madrid'),
  );
  assertEquals(result?.intent, 'confirm');
  assertEquals(result?.confirmation, true);
});
