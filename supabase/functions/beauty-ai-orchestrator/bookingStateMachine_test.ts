import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { boundedCustomerContext, parseBookingInterpretation, redactInterpreterText } from './bookingInterpreter.ts';
import { ambiguousServiceReply, askDateForActiveSession, askDateForService, availabilityReply, selectionReply, timeClarificationReply } from './bookingReplies.ts';
import {
  deterministicDateOverride,
  interpretBookingDeterministically,
  isExistingAppointmentCancellation,
  isExistingAppointmentReschedule,
  isBookingStatusQuestion,
  isOutOfDomainMessage,
  isSocialMessage,
  normalizeRequestedTime,
  resolveRequestedDate,
  resolveServiceReference,
  resolveStaffReference,
  resolveTimeExpression,
} from './bookingResolvers.ts';
import { resolveServiceText } from './serviceAliases.ts';
import { reduceBookingState } from './bookingStateMachine.ts';
import { optionForRequestedTime, persistExactOption, resumeAnswer, resumeReplyForSession, visibleAvailability } from './bookingFlow.ts';
import { buildTemporalContext, formatCustomerDate } from './dateResolution.ts';
import { pendingBookingField, type BookingInterpretation, type BookingSession, type OfferedTime } from './bookingTypes.ts';

const options: OfferedTime[] = [
  { starts_at: '2026-08-03T09:00:00+02:00', staff_id: '11111111-1111-4111-8111-111111111111', staff_display_name: 'Ana', label: '09:00' },
  { starts_at: '2026-08-03T10:00:00+02:00', staff_id: '11111111-1111-4111-8111-111111111111', staff_display_name: 'Ana', label: '10:00' },
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

Deno.test('awaiting confirmation prioritizes yes and a time correction over staff resolution', () => {
  const awaiting = {
    ...session,
    status: 'awaiting_confirmation' as const,
    staff_id: options[0].staff_id,
    staff_preference: 'selected' as const,
    selected_starts_at: options[0].starts_at,
  };
  const temporal = buildTemporalContext(new Date('2026-08-02T10:00:00Z'), 'Europe/Madrid');
  assertEquals(interpretBookingDeterministically('Si', 'awaiting_confirmation', [], temporal, awaiting)?.intent, 'confirm');
  const time = interpretBookingDeterministically('Mejor a las nueve', 'awaiting_confirmation', [], temporal, awaiting);
  assertEquals(time?.intent, 'choose_time');
  assertEquals(time?.time_expression, '09:00');
  assertEquals(isBookingStatusQuestion('¿Pero tengo la reserva?'), true);
  assertEquals(isBookingStatusQuestion('¿Qué horarios tenéis?'), false);
});

Deno.test('awaiting confirmation confirms yes, while no never confirms', () => {
  const awaiting = {
    ...session,
    status: 'awaiting_confirmation' as const,
    staff_id: options[0].staff_id,
    staff_preference: 'selected' as const,
    selected_starts_at: options[0].starts_at,
  };
  const confirmed = reduceBookingState({
    session: awaiting, interpretation: { ...interpretation, intent: 'confirm', confirmation: true }, rawText: 'Si',
    dateLabel: 'domingo 3 de agosto', nowIso: '2026-08-02T10:00:00Z',
    resolved: { serviceId: awaiting.service_id, selectedDate: awaiting.selected_date, selectedOption: null, staffExplicit: false, expired: false, revalidation: 'available', availabilityOptions: options },
  });
  assertEquals(confirmed.operation, 'confirm_booking');
  const rejected = reduceBookingState({
    session: awaiting, interpretation: { ...interpretation, intent: 'reject', confirmation: false }, rawText: 'No',
    dateLabel: 'domingo 3 de agosto', nowIso: '2026-08-02T10:00:00Z',
    resolved: { serviceId: awaiting.service_id, selectedDate: awaiting.selected_date, selectedOption: null, expired: false },
  });
  assertEquals(rejected.operation, 'none');
  assertEquals(rejected.next?.status, 'cancelled');
});

Deno.test('duplicate times always keep their professional in every clarification copy', () => {
  const duplicate = [
    { ...options[0], staff_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', staff_display_name: 'Ana' },
    { ...options[0], staff_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', staff_display_name: 'Bea' },
  ];
  const copy = timeClarificationReply(duplicate);
  assert(copy.includes('09:00 con Ana'));
  assert(copy.includes('09:00 con Bea'));
});

Deno.test('short customer context is bounded and has no session metadata', () => {
  const context = boundedCustomerContext([' Quiero cortarme el pelo ', 'Ya te lo he dicho', 'Ese mismo', 'Lo de antes']);
  assertEquals(context, ['Ya te lo he dicho', 'Ese mismo', 'Lo de antes']);
  assertEquals(context.some((message) => message.includes('55555555')), false);
  assertEquals(redactInterpreterText('Llámame al +34 611 102 304, id 11111111-1111-4111-8111-111111111111'), 'Llámame al [teléfono omitido], id [identificador omitido]');
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

Deno.test('natural service aliases resolve only to one real catalog service', () => {
  const catalog = [{ id: '55555555-5555-4555-8555-555555555555', name: 'Corte de pelo' }];
  assertEquals(resolveServiceReference('Corte de pelo', catalog), catalog[0].id);
  for (const alias of ['Quiero pelarme', 'Quiero cortarme el pelo', 'Quiero corte de pelo', 'Quiero recortarme el pelo', 'Quiero arreglarme el pelo']) {
    assertEquals(resolveServiceReference(alias, catalog), catalog[0].id);
  }
  assertEquals(resolveServiceReference('Servicio inventado', catalog), null);
  const temporal = buildTemporalContext(new Date('2026-07-31T08:00:00Z'), 'Europe/Madrid');
  assertEquals(interpretBookingDeterministically('Corte de pelo', 'choosing_service', catalog, temporal)?.service_reference, 'Corte de pelo');
  for (const alias of ['Quiero pelarme', 'Quiero cortarme el pelo']) {
    assertEquals(interpretBookingDeterministically(alias, 'choosing_service', catalog, temporal)?.service_reference, 'Corte de pelo');
  }
  const choosingService = { ...session, status: 'choosing_service' as const, service_id: null, selected_date: null, offered_times: [] };
  for (const rawText of ['Quiero cortarme el pelo', 'Cortarme el pelo', 'Quiero un corte', 'Ya te lo he dicho']) {
    const result = reduceBookingState({
      session: choosingService,
      interpretation: { ...interpretation, intent: 'choose_service', service_reference: 'Corte de pelo' },
      rawText,
      resolved: { serviceId: catalog[0].id, selectedDate: null, selectedOption: null, serviceExplicit: true, expired: false },
      dateLabel: 'ese día', nowIso: '2026-08-02T10:01:00Z',
    });
    assertEquals(result.next?.status, 'choosing_date');
    assertEquals(result.next?.service_id, catalog[0].id);
  }
});

Deno.test('service aliases are ambiguous safely and exact names keep priority', () => {
  const catalog = [
    { id: '55555555-5555-4555-8555-555555555551', name: 'Corte' },
    { id: '55555555-5555-4555-8555-555555555552', name: 'Corte infantil' },
  ];
  assertEquals(resolveServiceText('Corte infantil', catalog), { service: catalog[1], ambiguous: false, candidates: [catalog[1]] });
  assertEquals(resolveServiceText('Quiero pelarme', catalog), { service: null, ambiguous: true, candidates: catalog });
  assertEquals(resolveServiceReference('Quiero pelarme', catalog), null);
  const temporal = buildTemporalContext(new Date('2026-07-31T08:00:00Z'), 'Europe/Madrid');
  const ambiguous = interpretBookingDeterministically('Quiero pelarme', 'choosing_service', catalog, temporal);
  assertEquals(ambiguous?.intent, 'choose_service');
  assertEquals(ambiguous?.service_reference, null);
});

Deno.test('resume confirmation is consumed before booking parsing and restores each pending prompt', () => {
  const temporal = buildTemporalContext(new Date('2026-08-02T10:00:00Z'), 'Europe/Madrid');
  const catalog = [{ id: session.service_id!, name: 'Corte' }];
  const professionals = [
    { staff_id: options[0].staff_id, staff_display_name: 'Ana' },
    { staff_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', staff_display_name: 'Bea' },
  ];
  const cases: Array<[BookingSession, string]> = [
    [{ ...session, status: 'choosing_service', service_id: null, selected_date: null, offered_times: [] }, '¿Qué servicio te gustaría reservar?'],
    [{ ...session, status: 'choosing_professional', offered_professionals: professionals, selected_date: null, offered_times: [] }, 'Ana y Bea están disponibles para este servicio. ¿Con quién te gustaría reservar?'],
    [{ ...session, status: 'choosing_date', selected_date: null, offered_times: [] }, '¿Qué día te vendría bien para el corte?'],
    [{ ...session, status: 'choosing_time' }, '¿A qué hora te vendría bien?'],
    [{ ...session, status: 'awaiting_confirmation', staff_id: options[0].staff_id, selected_starts_at: options[0].starts_at }, 'Has elegido lunes 3 de agosto a las 09:00 con Ana. ¿Quieres confirmar la cita?'],
  ];
  assertEquals(resumeAnswer('Sí'), 'yes');
  assertEquals(resumeAnswer('No'), 'no');
  assertEquals(resumeAnswer('mañana'), null);
  assertEquals(interpretBookingDeterministically('Sí', 'choosing_date', catalog, temporal), null);
  for (const [pending, expected] of cases) {
    assertEquals(resumeReplyForSession(pending, catalog, temporal.timezone), expected);
  }
});

Deno.test('ambiguous aliases show only their real catalog candidates', () => {
  const matches = [
    { id: '55555555-5555-4555-8555-555555555551', name: 'Corte' },
    { id: '55555555-5555-4555-8555-555555555552', name: 'Corte hombre' },
    { id: '55555555-5555-4555-8555-555555555553', name: 'Corte infantil' },
  ];
  assertEquals(
    ambiguousServiceReply(matches),
    'Tengo varios servicios que podrían encajar: Corte, Corte hombre y Corte infantil. ¿Cuál necesitas?',
  );
});

Deno.test('Nieves regression: date windows and compound dates cannot become bare times', () => {
  const temporal = buildTemporalContext(new Date('2026-10-09T12:00:00Z'), 'Europe/Madrid');
  const nextWeek = resolveRequestedDate('La semana que viene', interpretation, temporal);
  assertEquals(nextWeek.status, 'window');
  if (nextWeek.status === 'window') {
    assertEquals(nextWeek.startDate, '2026-10-12');
    assertEquals(nextWeek.endDate, '2026-10-18');
  }
  for (const synonym of ['la próxima semana', 'la semana próxima', 'la siguiente semana', 'la semana siguiente']) {
    const window = resolveRequestedDate(synonym, interpretation, temporal);
    assertEquals(window.status, 'window');
    if (window.status === 'window') {
      assertEquals(window.startDate, '2026-10-12');
      assertEquals(window.endDate, '2026-10-18');
    }
  }
  const inconsistent = resolveRequestedDate('Martes 19', interpretation, temporal);
  assertEquals(inconsistent.status, 'inconsistent');
  assertEquals(deterministicDateOverride('choosing_date', 'La semana que viene', temporal)?.resolution.status, 'window');
  assertEquals(deterministicDateOverride('choosing_date', 'Martes 19', temporal)?.resolution.status, 'inconsistent');
  assertEquals(normalizeRequestedTime('19', interpretation, false), null);
  assertEquals(normalizeRequestedTime('19', interpretation, true), '19:00');
  assertEquals(normalizeRequestedTime('a las 19', interpretation, false), '19:00');
  assertEquals(normalizeRequestedTime('19:00', interpretation, false), '19:00');
});

Deno.test('natural numeric minutes select only their exact offered slot', () => {
  const quarterOptions: OfferedTime[] = ['09:00', '09:15', '09:30', '09:45', '10:00'].map((label) => ({
    starts_at: `2026-10-22T${label}:00+02:00`,
    staff_id: options[0].staff_id,
    staff_display_name: 'FRAN',
    label,
  }));
  const choosingTime = { ...session, selected_date: '2026-10-22', offered_times: quarterOptions };
  const expected: Array<[string, string]> = [
    ['9 y 45', '09:45'], ['9 y 5', '09:05'], ['9 y 0', '09:00'], ['9:45', '09:45'],
    ['9 y cuarto', '09:15'], ['9 y media', '09:30'], ['10 menos cuarto', '09:45'],
  ];
  for (const [rawText, label] of expected) {
    assertEquals(normalizeRequestedTime(rawText, interpretation), label);
  }
  const selected = resolveTimeExpression('9 y 45', interpretation, choosingTime);
  assertEquals(selected?.label, '09:45');
  const result = reduceBookingState({
    session: choosingTime, interpretation, rawText: '9 y 45',
    resolved: { serviceId: choosingTime.service_id, selectedDate: choosingTime.selected_date, selectedOption: selected, requestedTime: '09:45', expired: false },
    dateLabel: formatCustomerDate('2026-10-22', 'Europe/Madrid'), nowIso: '2026-10-21T10:00:00Z',
  });
  assertEquals(result.next?.selected_starts_at, quarterOptions[3].starts_at);
  assert(result.reply.includes('09:45'));
  assert(!result.reply.includes('09:00'));

  const withoutQuarter = { ...choosingTime, offered_times: quarterOptions.filter((option) => option.label !== '09:45') };
  const unavailable = reduceBookingState({
    session: withoutQuarter, interpretation, rawText: '9 y 45',
    resolved: { serviceId: withoutQuarter.service_id, selectedDate: withoutQuarter.selected_date, selectedOption: null, requestedTime: '09:45', expired: false },
    dateLabel: formatCustomerDate('2026-10-22', 'Europe/Madrid'), nowIso: '2026-10-21T10:00:00Z',
  });
  assertEquals(unavailable.errorCode, 'TIME_NOT_OFFERED');
  assertEquals(unavailable.next?.selected_starts_at, null);
});

Deno.test('explicit minute separators never degrade to an hour in point', () => {
  const minuteOptions: OfferedTime[] = ['10:00', '10:30'].map((label) => ({
    starts_at: `2026-10-26T${label}:00+01:00`, staff_id: options[0].staff_id,
    staff_display_name: 'FRAN', label,
  }));
  const choosingTime = { ...session, status: 'choosing_time' as const, selected_date: '2026-10-26', offered_times: minuteOptions };
  for (const rawText of ['10:30', '10,30', '10.30', '10,30 podría ser', 'Quiero a las 10:30', 'Mejor a las 10:30']) {
    assertEquals(normalizeRequestedTime(rawText, interpretation), '10:30');
    assertEquals(resolveTimeExpression(rawText, interpretation, choosingTime)?.label, '10:30');
  }
  assertEquals(normalizeRequestedTime('A las 9 y 45', interpretation), '09:45');
  assertEquals(normalizeRequestedTime('Diez y media', interpretation), '10:30');
  assertEquals(normalizeRequestedTime('Las 10', interpretation), '10:00');
  for (const invalid of ['10:75', '10:300', '10,75 podría ser']) {
    assertEquals(normalizeRequestedTime(invalid, interpretation), null);
  }

  const awaiting = {
    ...choosingTime,
    status: 'awaiting_confirmation' as const,
    staff_id: minuteOptions[0].staff_id,
    staff_preference: 'selected' as const,
    selected_starts_at: minuteOptions[0].starts_at,
  };
  const changed = reduceBookingState({
    session: awaiting, interpretation: { ...interpretation, intent: 'choose_time' }, rawText: 'Quiero a las 10:30',
    dateLabel: 'lunes 26 de octubre', nowIso: '2026-10-25T10:00:00Z',
    resolved: { serviceId: awaiting.service_id, selectedDate: awaiting.selected_date, selectedOption: minuteOptions[1], requestedTime: '10:30', expired: false },
  });
  assertEquals(changed.next?.selected_starts_at, minuteOptions[1].starts_at);
  assertEquals(changed.next?.staff_id, awaiting.staff_id);
  assertEquals(changed.next?.selected_date, awaiting.selected_date);

  const unavailable = reduceBookingState({
    session: awaiting, interpretation: { ...interpretation, intent: 'choose_time' }, rawText: 'Quiero a las 10:30',
    dateLabel: 'lunes 26 de octubre', nowIso: '2026-10-25T10:00:00Z',
    resolved: { serviceId: awaiting.service_id, selectedDate: awaiting.selected_date, selectedOption: null, requestedTime: '10:30', expired: false },
  });
  assertEquals(unavailable.errorCode, 'TIME_NOT_OFFERED');
  assertEquals(unavailable.next?.status, 'choosing_time');
  assertEquals(unavailable.next?.selected_starts_at, null);
  assertEquals(unavailable.next?.staff_id, awaiting.staff_id);
  assertEquals(unavailable.next?.selected_date, awaiting.selected_date);
});

Deno.test('visible offers are a sample and an exact server-validated time can be selected', () => {
  const allOptions: OfferedTime[] = ['09:00', '09:15', '09:30', '09:45', '10:00', '10:30', '11:00'].map((label) => ({
    starts_at: `2026-10-26T${label}:00+01:00`, staff_id: options[0].staff_id,
    staff_display_name: 'FRAN', label,
  }));
  const visible = visibleAvailability(allOptions);
  assertEquals(visible.options.map((option) => option.label), ['09:00', '09:15', '09:30', '09:45', '10:00']);
  assertEquals(visible.hasMore, true);
  const exact = optionForRequestedTime(allOptions, '10:30');
  assertEquals(exact?.label, '10:30');
  const persisted = persistExactOption(visible.options, exact);
  assertEquals(persisted.at(-1)?.label, '10:30');
  assertEquals(optionForRequestedTime(allOptions, '12:00'), null);
  const indifferentMatches = [
    { ...exact!, staff_id: '11111111-1111-4111-8111-111111111111', staff_display_name: 'FRAN' },
    { ...exact!, staff_id: '22222222-2222-4222-8222-222222222222', staff_display_name: 'Nico' },
  ];
  const indifferentChoice = optionForRequestedTime(indifferentMatches, '10:30');
  assertEquals(indifferentChoice?.staff_display_name, 'FRAN');
  assert(selectionReply('lunes 26 de octubre', '10:30', indifferentChoice?.staff_display_name).includes('con FRAN'));

  const awaiting = {
    ...session,
    status: 'awaiting_confirmation' as const,
    staff_id: exact?.staff_id ?? null,
    staff_preference: 'selected' as const,
    selected_date: '2026-10-26',
    selected_starts_at: visible.options[0].starts_at,
    offered_times: persisted,
  };
  const changed = reduceBookingState({
    session: awaiting, interpretation: { ...interpretation, intent: 'choose_time' }, rawText: '10:30',
    dateLabel: 'lunes 26 de octubre', nowIso: '2026-10-25T10:00:00Z',
    resolved: { serviceId: awaiting.service_id, selectedDate: awaiting.selected_date, selectedOption: exact, requestedTime: '10:30', expired: false },
  });
  assertEquals(changed.next?.selected_starts_at, exact?.starts_at);
  assertEquals(changed.next?.staff_id, exact?.staff_id);

  const unavailable = reduceBookingState({
    session: awaiting, interpretation: { ...interpretation, intent: 'choose_time' }, rawText: '12:00',
    dateLabel: 'lunes 26 de octubre', nowIso: '2026-10-25T10:00:00Z',
    resolved: { serviceId: awaiting.service_id, selectedDate: awaiting.selected_date, selectedOption: null, requestedTime: '12:00', expired: false },
  });
  assertEquals(unavailable.errorCode, 'TIME_NOT_OFFERED');
  assertEquals(unavailable.next?.selected_starts_at, null);
});

Deno.test('customer-facing availability and selection use a human date label', () => {
  const label = formatCustomerDate('2026-10-22', 'Europe/Madrid');
  assertEquals(label, 'jueves 22 de octubre');
  assert(availabilityReply(label, options).includes(label));
  assert(availabilityReply(label, options, true).includes('primeros horarios disponibles'));
  assert(availabilityReply(label, options, true).includes('más disponibilidad durante el día'));
  assert(selectionReply(label, '09:45', 'FRAN').includes(label));
  assert(!availabilityReply(label, options).includes('2026-10-22'));
});

Deno.test('choosing date never validates a bare number against stale offered times', () => {
  const choosingDate = { ...session, status: 'choosing_date' as const, selected_date: null, offered_times: options };
  const result = reduceBookingState({
    session: choosingDate,
    interpretation: { ...interpretation, intent: 'unknown' },
    rawText: '19',
    resolved: {
      serviceId: choosingDate.service_id, selectedDate: null, selectedOption: null,
      requestedTime: normalizeRequestedTime('19', interpretation, false), expired: false,
    },
    dateLabel: 'ese día', nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.next?.status, 'choosing_date');
  assertEquals(result.errorCode, null);
  assert(!result.reply.startsWith('Esa hora'));
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
  assertEquals(askDateForActiveSession('Corte'), '¿Qué día te vendría bien para el corte?');
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
  assert(result.reply.includes('¿Quieres confirmar la cita?'));
  assert(!result.reply.toLowerCase().includes('persona del negocio'));
  assert(result.reply.includes('con Ana'));
});

Deno.test('confirmation wording is controlled and does not mention a human team', () => {
  const reply = selectionReply('el lunes 3 de agosto', '09:00', 'Ana');
  assertEquals(reply, 'Has elegido el lunes 3 de agosto a las 09:00 con Ana. ¿Quieres confirmar la cita?');
  assert(!reply.toLowerCase().includes('persona'));
});

Deno.test('an affirmative in awaiting confirmation keeps the real booking confirmation path', () => {
  const awaiting = { ...session, status: 'awaiting_confirmation' as const, selected_starts_at: options[0].starts_at, staff_id: options[0].staff_id };
  const result = reduceBookingState({
    session: awaiting,
    interpretation: { ...interpretation, intent: 'confirm', confirmation: true },
    rawText: 'sí',
    resolved: { serviceId: awaiting.service_id, selectedDate: awaiting.selected_date, selectedOption: options[0], revalidation: 'available', expired: false },
    dateLabel: 'el lunes', nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.operation, 'confirm_booking');
  assertEquals(result.handoff, false);
});

Deno.test('an explicit request to cancel an existing appointment is not treated as a new booking', () => {
  const temporal = buildTemporalContext(new Date('2026-07-31T08:00:00Z'), 'Europe/Madrid');
  const request = 'Quiero cancelar la cita';
  assertEquals(isExistingAppointmentCancellation(request), true);
  assertEquals(interpretBookingDeterministically(request, null, [], temporal)?.intent, 'cancel_existing');
  assertEquals(isExistingAppointmentCancellation('No sé si podré ir'), false);
});

Deno.test('an existing-appointment cancellation follows the safe human handoff without creating a booking', () => {
  const result = reduceBookingState({
    session: null,
    interpretation: { ...interpretation, intent: 'cancel_existing' },
    rawText: 'Quiero cancelar la cita',
    resolved: { serviceId: null, selectedDate: null, selectedOption: null, expired: false },
    dateLabel: 'ese día', nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.operation, 'send_handoff');
  assertEquals(result.handoff, true);
  assertEquals(result.createSession, false);
  assert(result.reply.includes('cancelación'));
});

Deno.test('ambiguous cancellation wording preserves an active booking and performs no action', () => {
  const active = { ...session, status: 'choosing_date' as const, selected_date: null, offered_times: [] };
  const result = reduceBookingState({
    session: active,
    interpretation: { ...interpretation, intent: 'unknown' },
    rawText: 'Quiero cancelar',
    resolved: { serviceId: active.service_id, selectedDate: null, selectedOption: null, expired: false },
    dateLabel: 'ese día', nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.next?.status, 'choosing_date');
  assertEquals(result.handoff, false);
  assertEquals(result.operation, 'none');
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

Deno.test('choosing service advances only to choosing date without handoff', () => {
  const result = reduceBookingState({
    session: { ...session, status: 'choosing_service', service_id: null, selected_date: null, offered_times: [] },
    interpretation: { ...interpretation, intent: 'choose_service', service_reference: 'Corte' },
    rawText: 'Corte',
    resolved: {
      serviceId: session.service_id,
      selectedDate: null,
      selectedOption: null,
      serviceExplicit: true,
      expired: false,
    },
    dateLabel: 'ese día',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.next?.status, 'choosing_date');
  assertEquals(result.next?.service_id, session.service_id);
  assertEquals(result.operation, 'none');
  assertEquals(result.handoff, false);
});

Deno.test('unsupported input preserves choosing date and never hands off', () => {
  const result = reduceBookingState({
    session: { ...session, status: 'choosing_date', selected_date: null, offered_times: [] },
    interpretation: { ...interpretation, intent: 'unknown' },
    rawText: 'no lo sé',
    resolved: { serviceId: session.service_id, selectedDate: null, selectedOption: null, expired: false },
    dateLabel: 'ese día',
    nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.next?.status, 'choosing_date');
  assertEquals(result.handoff, false);
  assertEquals(result.operation, 'none');
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

Deno.test('availability asks for a natural time before listing slots, unless the customer is indifferent', () => {
  const awaitingTime = { ...session, status: 'choosing_time' as const, offered_times: [] };
  const afterDate = reduceBookingState({
    session: awaitingTime, interpretation: { ...interpretation, intent: 'choose_date' }, rawText: 'lunes',
    resolved: { serviceId: awaitingTime.service_id, selectedDate: awaitingTime.selected_date, selectedOption: null, availabilityOptions: options, expired: false },
    dateLabel: 'lunes 3 de agosto', nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(afterDate.next?.status, 'choosing_time');
  assertEquals(afterDate.reply, '¿A qué hora te vendría bien?');
  assert(!afterDate.reply.includes('09:00'));

  const indifferent = reduceBookingState({
    session: { ...afterDate.next!, offered_times: options }, interpretation, rawText: 'me da igual la hora',
    resolved: { serviceId: awaitingTime.service_id, selectedDate: awaitingTime.selected_date, selectedOption: null, expired: false },
    dateLabel: 'lunes 3 de agosto', nowIso: '2026-08-02T10:01:00Z',
  });
  assert(indifferent.reply.includes('09:00'));
  assert(indifferent.reply.includes('10:00'));
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
  assertEquals(result.operation, 'confirm_booking');
  assertEquals(result.handoff, false);
  assertEquals(result.reply, '');
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
  assertEquals(normalizeRequestedTime('12 y media', interpretation), '12:30');
  assertEquals(normalizeRequestedTime('11 y cuarto', interpretation), '11:15');
  assertEquals(normalizeRequestedTime('las 12 menos cuarto', interpretation), '11:45');
});

Deno.test('a completed booking can request a safe reschedule handoff without starting another booking', () => {
  const temporal = buildTemporalContext(new Date('2026-07-31T08:00:00Z'), 'Europe/Madrid');
  const request = 'Y cambiar la hora?';
  assertEquals(isExistingAppointmentReschedule(request), true);
  assertEquals(interpretBookingDeterministically(request, null, [], temporal)?.intent, 'reschedule_existing');
  const result = reduceBookingState({
    session: null,
    interpretation: { ...interpretation, intent: 'reschedule_existing' },
    rawText: request,
    resolved: { serviceId: null, selectedDate: null, selectedOption: null, expired: false },
    dateLabel: 'ese día', nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.operation, 'send_handoff');
  assertEquals(result.createSession, false);
  assert(result.reply.includes('cambiar la hora'));
});

Deno.test('social and out-of-domain messages do not start a booking', () => {
  const temporal = buildTemporalContext(new Date('2026-07-31T08:00:00Z'), 'Europe/Madrid');
  assertEquals(isSocialMessage('Gracias'), true);
  assertEquals(interpretBookingDeterministically('Gracias', null, [], temporal)?.intent, 'social');
  assertEquals(isOutOfDomainMessage('Quiero ir a la playa'), true);
  assertEquals(interpretBookingDeterministically('Quiero ir a la playa', null, [], temporal)?.intent, 'out_of_domain');
  for (const intent of ['social', 'out_of_domain'] as const) {
    const result = reduceBookingState({
      session: null,
      interpretation: { ...interpretation, intent },
      rawText: intent,
      resolved: { serviceId: null, selectedDate: null, selectedOption: null, expired: false },
      dateLabel: 'ese día', nowIso: '2026-08-02T10:01:00Z',
    });
    assertEquals(result.createSession, false);
    assertEquals(result.handoff, false);
    assert(intent === 'social' ? result.reply.includes('De nada') : result.reply.includes('citas'));
  }
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

Deno.test('pending field is derived from persisted session shape without storing a new column', () => {
  assertEquals(pendingBookingField(null), 'service');
  assertEquals(pendingBookingField({ ...session, status: 'choosing_date', selected_date: null }), 'date');
  assertEquals(pendingBookingField({ ...session, status: 'choosing_time', selected_starts_at: null }), 'time');
});

Deno.test('partial corrections preserve the remaining booking context', () => {
  const friday = reduceBookingState({
    session,
    interpretation: { ...interpretation, intent: 'change_selection', date_expression: 'viernes' },
    rawText: 'No, mejor el viernes',
    resolved: { serviceId: session.service_id, selectedDate: '2026-08-07', selectedOption: null, dateExplicit: true, expired: false },
    dateLabel: 'el viernes', nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(friday.next?.service_id, session.service_id);
  assertEquals(friday.next?.selected_date, '2026-08-07');
  assertEquals(friday.next?.offered_times, []);
  assertEquals(friday.operation, 'query_availability');

  const atSix = reduceBookingState({
    session,
    interpretation,
    rawText: 'A las 6 mejor',
    resolved: { serviceId: session.service_id, selectedDate: session.selected_date, selectedOption: null, requestedTime: '18:00', expired: false },
    dateLabel: 'el lunes', nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(atSix.next?.service_id, session.service_id);
  assertEquals(atSix.next?.selected_date, session.selected_date);
  assertEquals(atSix.errorCode, 'TIME_NOT_OFFERED');
});

Deno.test('professional correction is deterministic and refreshes only the availability options', () => {
  assertEquals(resolveStaffReference('Con Ana', session), options[0].staff_id);
  const result = reduceBookingState({
    session,
    interpretation: { ...interpretation, intent: 'change_selection', staff_reference: 'Ana' },
    rawText: 'Con Ana',
    resolved: {
      serviceId: session.service_id, selectedDate: session.selected_date, selectedOption: null,
      staffId: options[0].staff_id, staffExplicit: true, expired: false,
    },
    dateLabel: 'el lunes', nowIso: '2026-08-02T10:01:00Z',
  });
  assertEquals(result.next?.staff_id, options[0].staff_id);
  assertEquals(result.next?.service_id, session.service_id);
  assertEquals(result.next?.selected_date, session.selected_date);
  assertEquals(result.operation, 'query_availability');
});

Deno.test('ambiguous, typo and empty-style inputs preserve the pending context', () => {
  const choosingDate = { ...session, status: 'choosing_date' as const, selected_date: null, offered_times: [] };
  for (const rawText of ['Nañana', '🤔', '']) {
    const result = reduceBookingState({
      session: choosingDate,
      interpretation: { ...interpretation, intent: rawText === 'Nañana' ? 'choose_date' : 'unknown' },
      rawText,
      resolved: { serviceId: session.service_id, selectedDate: rawText === 'Nañana' ? '2026-08-03' : null, selectedOption: null, dateExplicit: rawText === 'Nañana', expired: false },
      dateLabel: 'mañana', nowIso: '2026-08-02T10:01:00Z',
    });
    assertEquals(result.next?.service_id, session.service_id);
  }
});

Deno.test('part-of-day and repeated incomprehension keep a choosing-time session intact', () => {
  for (const rawText of ['Por la tarde', 'No sé', '🤷']) {
    const result = reduceBookingState({
      session,
      interpretation: { ...interpretation, intent: 'unknown' },
      rawText,
      resolved: { serviceId: session.service_id, selectedDate: session.selected_date, selectedOption: null, expired: false },
      dateLabel: 'el lunes', nowIso: '2026-08-02T10:01:00Z',
    });
    assertEquals(result.next?.status, 'choosing_time');
    assertEquals(result.next?.service_id, session.service_id);
    assertEquals(result.handoff, false);
  }
});
