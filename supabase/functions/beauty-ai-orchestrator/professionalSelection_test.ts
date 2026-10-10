import { assert, assertEquals } from 'jsr:@std/assert@1';
import { askDateForService, availabilityReply, incompatibleProfessionalReply, professionalReply } from './bookingReplies.ts';
import { extractStaffReference, isIndifferentStaffPreference, resolveStaffFromCatalog, resolveStaffReference, resolveTimeExpression } from './bookingResolvers.ts';
import { professionalGate } from './professionalSelection.ts';
import { reduceBookingState } from './bookingStateMachine.ts';
import type { BookingInterpretation, BookingSession, OfferedProfessional, OfferedTime } from './bookingTypes.ts';

const ana = '11111111-1111-4111-8111-111111111111';
const bea = '22222222-2222-4222-8222-222222222222';
const professionals: OfferedProfessional[] = [
  { staff_id: ana, staff_display_name: 'Ana' },
  { staff_id: bea, staff_display_name: 'Bea' },
];
const duplicatedHour: OfferedTime[] = [
  { starts_at: '2026-10-13T09:00:00+02:00', staff_id: ana, staff_display_name: 'Ana', label: '09:00' },
  { starts_at: '2026-10-13T09:00:00+02:00', staff_id: bea, staff_display_name: 'Bea', label: '09:00' },
  { starts_at: '2026-10-13T09:15:00+02:00', staff_id: bea, staff_display_name: 'Bea', label: '09:15' },
];
const interpretation: BookingInterpretation = {
  intent: 'change_selection', service_reference: null, date_expression: null, time_expression: null,
  option_reference: null, confirmation: null, wants_human: false, confidence: 1,
};
const session: BookingSession = {
  id: '33333333-3333-4333-8333-333333333333', business_id: '44444444-4444-4444-8444-444444444444',
  conversation_id: '55555555-5555-4555-8555-555555555555', status: 'choosing_professional',
  service_id: '66666666-6666-4666-8666-666666666666', staff_id: null, staff_preference: 'unasked',
  offered_professionals: professionals, selected_date: null, offered_times: [], selected_starts_at: null,
  source_ai_run_id: null, last_processed_inbound_message_id: null, last_response_message_id: null,
  last_interpretation_intent: null, last_error_code: null, handoff_reason: null, version: 1,
  availability_checked_at: null, appointment_id: null, confirmed_at: null, expires_at: '2026-10-12T12:00:00Z',
};

Deno.test('one compatible professional is assigned without a question', () => {
  const gate = professionalGate([professionals[0]]);
  assertEquals(gate.status, 'choosing_date');
  assertEquals(gate.staff_id, ana);
  assertEquals(gate.staff_preference, 'selected');
});

Deno.test('two compatible professionals require an explicit real-professional selection', () => {
  const gate = professionalGate(professionals);
  assertEquals(gate.status, 'choosing_professional');
  assertEquals(gate.staff_id, null);
  assertEquals(gate.staff_preference, 'unasked');
  assert(professionalReply(professionals).includes('Ana'));
  assert(professionalReply(professionals).includes('Bea'));
});

Deno.test('named professionals resolve only from the persisted compatible catalog', () => {
  assertEquals(resolveStaffReference('Con Ana', session), ana);
  assertEquals(resolveStaffReference('Ana', session), ana);
  assertEquals(resolveStaffReference('Con Carla', session), null);
});

Deno.test('homonymous professional references require clarification', () => {
  const homonyms = { ...session, offered_professionals: [
    { staff_id: ana, staff_display_name: 'Ana García' },
    { staff_id: bea, staff_display_name: 'Ana López' },
  ] };
  assertEquals(resolveStaffReference('Ana', homonyms), null);
});

Deno.test('all explicit no-preference phrases select the earliest real option only after the preference', () => {
  for (const phrase of ['me da igual', 'cualquiera', 'quien tenga antes', 'el primero disponible', 'cualquiera.']) {
    assertEquals(isIndifferentStaffPreference(phrase), true);
  }
  const indifferent = { ...session, status: 'choosing_time' as const, selected_date: '2026-10-13',
    staff_preference: 'indifferent' as const, offered_times: [] };
  const result = reduceBookingState({
    session: indifferent, interpretation, rawText: 'martes', dateLabel: 'martes 13 de octubre', nowIso: '2026-10-12T09:00:00Z',
    resolved: { serviceId: indifferent.service_id, selectedDate: indifferent.selected_date, selectedOption: null, availabilityOptions: duplicatedHour, expired: false },
  });
  assertEquals(result.next?.status, 'awaiting_confirmation');
  assertEquals(result.next?.staff_id, ana);
  assertEquals(result.next?.selected_starts_at, duplicatedHour[0].starts_at);
  assert(result.reply.includes('09:00 con Ana'));
});

Deno.test('a duplicated clock label never implicitly chooses one professional', () => {
  const choosingTime = { ...session, status: 'choosing_time' as const, selected_date: '2026-10-13',
    staff_preference: 'unasked' as const, offered_times: duplicatedHour };
  assertEquals(resolveTimeExpression('09:00', interpretation, choosingTime), null);
  const result = reduceBookingState({
    session: choosingTime, interpretation: { ...interpretation, intent: 'choose_time' }, rawText: '09:00',
    dateLabel: 'martes 13 de octubre', nowIso: '2026-10-12T09:00:00Z',
    resolved: { serviceId: choosingTime.service_id, selectedDate: choosingTime.selected_date, selectedOption: null, requestedTime: '09:00', expired: false },
  });
  assertEquals(result.errorCode, 'TIME_NOT_OFFERED');
  assertEquals(result.next?.staff_id, null);
  const reply = availabilityReply('martes 13 de octubre', duplicatedHour);
  assert(reply.includes('09:00 con Ana'));
  assert(reply.includes('09:00 con Bea'));
});

Deno.test('a date change preserves a concrete professional preference', () => {
  const selected = {
    ...session,
    status: 'choosing_date' as const,
    staff_id: ana,
    staff_preference: 'selected' as const,
    selected_date: null,
  };
  const result = reduceBookingState({
    session: selected, interpretation: { ...interpretation, intent: 'choose_date' }, rawText: 'martes',
    dateLabel: 'martes 13 de octubre', nowIso: '2026-10-12T09:00:00Z',
    resolved: { serviceId: selected.service_id, selectedDate: '2026-10-13', selectedOption: null, dateExplicit: true, expired: false },
  });
  assertEquals(result.next?.staff_id, ana);
  assertEquals(result.next?.staff_preference, 'selected');
  assertEquals(result.operation, 'query_availability');
});

Deno.test('a professional correction clears stale offers and re-queries availability', () => {
  const choosingTime = {
    ...session,
    status: 'choosing_time' as const,
    selected_date: '2026-10-13',
    staff_id: ana,
    staff_preference: 'selected' as const,
    offered_times: duplicatedHour,
  };
  const result = reduceBookingState({
    session: choosingTime, interpretation, rawText: 'Con Bea',
    dateLabel: 'martes 13 de octubre', nowIso: '2026-10-12T09:00:00Z',
    resolved: { serviceId: choosingTime.service_id, selectedDate: choosingTime.selected_date, selectedOption: null, staffId: bea, staffExplicit: true, expired: false },
  });
  assertEquals(result.next?.staff_id, bea);
  assertEquals(result.next?.offered_times, []);
  assertEquals(result.next?.selected_starts_at, null);
  assertEquals(result.operation, 'query_availability');
});

Deno.test('a service change clears the former professional preference and offers', () => {
  const selected = {
    ...session,
    status: 'choosing_time' as const,
    staff_id: ana,
    staff_preference: 'selected' as const,
    selected_date: '2026-10-13',
    offered_times: duplicatedHour,
  };
  const replacementService = '77777777-7777-4777-8777-777777777777';
  const result = reduceBookingState({
    session: selected, interpretation: { ...interpretation, intent: 'choose_service' }, rawText: 'otro servicio',
    dateLabel: 'ese día', nowIso: '2026-10-12T09:00:00Z',
    resolved: { serviceId: replacementService, selectedDate: selected.selected_date, selectedOption: null, serviceExplicit: true, expired: false },
  });
  assertEquals(result.next?.service_id, replacementService);
  assertEquals(result.next?.staff_id, null);
  assertEquals(result.next?.staff_preference, 'unasked');
  assertEquals(result.next?.offered_professionals, []);
  assertEquals(result.next?.selected_date, null);
  assertEquals(result.next?.offered_times, []);
});

Deno.test('a compatible professional request from awaiting confirmation invalidates the provisional selection', () => {
  const awaiting = {
    ...session,
    status: 'awaiting_confirmation' as const,
    staff_id: ana,
    staff_preference: 'selected' as const,
    selected_date: '2026-10-13',
    selected_starts_at: duplicatedHour[0].starts_at,
    offered_times: duplicatedHour,
  };
  const result = reduceBookingState({
    session: awaiting, interpretation, rawText: 'Puede ser con Bea?',
    dateLabel: 'martes 13 de octubre', nowIso: '2026-10-12T09:00:00Z',
    resolved: { serviceId: awaiting.service_id, selectedDate: awaiting.selected_date, selectedOption: null, staffId: bea, staffExplicit: true, expired: false },
  });
  assertEquals(result.next?.staff_id, bea);
  assertEquals(result.next?.staff_preference, 'selected');
  assertEquals(result.next?.selected_starts_at, null);
  assertEquals(result.next?.offered_times, []);
  assertEquals(result.next?.status, 'choosing_time');
  assertEquals(result.operation, 'query_availability');
});

Deno.test('an incompatible professional is detectable without accepting the stale confirmation', () => {
  const nico = '77777777-7777-4777-8777-777777777777';
  const activeBusinessStaff: OfferedProfessional[] = [...professionals, { staff_id: nico, staff_display_name: 'Nico' }];
  assertEquals(extractStaffReference('Puede ser con Nico?'), 'nico');
  assertEquals(resolveStaffFromCatalog('Puede ser con Nico?', professionals), null);
  assertEquals(resolveStaffFromCatalog('Puede ser con Nico?', activeBusinessStaff), nico);
  assert(incompatibleProfessionalReply('Nico', 'Corte', professionals).includes('Nico no realiza'));
});

Deno.test('selected professional survives no availability and filters the next date', () => {
  const chosenNico = {
    ...session,
    status: 'choosing_date' as const,
    staff_id: bea,
    staff_preference: 'selected' as const,
    selected_date: null,
    offered_times: [],
  };
  const noSlots = reduceBookingState({
    session: chosenNico, interpretation: { ...interpretation, intent: 'choose_date' }, rawText: 'mañana',
    dateLabel: 'mañana', nowIso: '2026-10-12T09:00:00Z',
    resolved: { serviceId: chosenNico.service_id, selectedDate: '2026-10-13', selectedOption: null, dateExplicit: true, availabilityOptions: [], expired: false },
  });
  assertEquals(noSlots.next?.status, 'choosing_date');
  assertEquals(noSlots.next?.selected_date, null);
  assertEquals(noSlots.next?.staff_preference, 'selected');
  assertEquals(noSlots.next?.staff_id, bea);
  const thursday = reduceBookingState({
    session: noSlots.next!, interpretation: { ...interpretation, intent: 'choose_date' }, rawText: 'jueves',
    dateLabel: 'jueves 15 de octubre', nowIso: '2026-10-12T09:00:00Z',
    resolved: { serviceId: chosenNico.service_id, selectedDate: '2026-10-15', selectedOption: null, dateExplicit: true, expired: false },
  });
  assertEquals(thursday.next?.staff_id, bea);
  assertEquals(thursday.next?.staff_preference, 'selected');
  assertEquals(thursday.operation, 'query_availability');
});

Deno.test('a service resolved in the first customer message uses the no-greeting date prompt', () => {
  assert(!askDateForService('Corte', false).startsWith('Hola.'));
});
