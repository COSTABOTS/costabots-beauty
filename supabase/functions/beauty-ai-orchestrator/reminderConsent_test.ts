import { assertEquals } from 'jsr:@std/assert@1';
import {
  reminderConsentDeferredReply,
  reminderConsentDeniedReply,
  reminderConsentGrantedReply,
  reminderConsentPrompt,
  isLikelyNewBookingRequest,
  resolveReminderConsentChoice,
  shouldAskReminderConsent,
} from './reminderConsent.ts';

Deno.test('consent prompt recognizes only explicit affirmative and negative answers', () => {
  for (const answer of ['Sí', 'si', 'vale', 'sí, por favor', 'Por supuesto']) {
    assertEquals(resolveReminderConsentChoice(answer), 'granted');
  }
  for (const answer of ['No', 'no gracias', 'prefiero que no']) {
    assertEquals(resolveReminderConsentChoice(answer), 'denied');
  }
  for (const answer of ['no sé', 'quizá', 'luego', 'quiero un corte']) {
    assertEquals(resolveReminderConsentChoice(answer), 'defer');
  }
});

Deno.test('consent copy does not promise immediate delivery', () => {
  assertEquals(reminderConsentPrompt, '¿Quieres que te recuerde tus citas por WhatsApp el día anterior?');
  assertEquals(reminderConsentGrantedReply, 'Perfecto, te recordaré tus citas por WhatsApp el día anterior.');
  assertEquals(reminderConsentDeniedReply, 'De acuerdo, no te enviaré recordatorios de citas.');
  assertEquals(reminderConsentDeferredReply, 'Sin problema. Puedes decírmelo más adelante.');
});

Deno.test('only an unknown customer with an awaiting reminder is prompted', () => {
  assertEquals(shouldAskReminderConsent('unknown', 'awaiting_consent'), true);
  assertEquals(shouldAskReminderConsent('granted', 'awaiting_consent'), false);
  assertEquals(shouldAskReminderConsent('denied', 'awaiting_consent'), false);
  assertEquals(shouldAskReminderConsent('unknown', 'skipped'), false);
  assertEquals(shouldAskReminderConsent('unknown', 'sent'), false);
  assertEquals(shouldAskReminderConsent('unknown', 'cancelled'), false);
});

Deno.test('a new booking request is never interpreted as a deferred consent reply', () => {
  assertEquals(isLikelyNewBookingRequest('Quiero una cita para cortarme el pelo'), true);
  assertEquals(isLikelyNewBookingRequest('Reserva un tinte mañana'), true);
  assertEquals(isLikelyNewBookingRequest('no sé'), false);
  assertEquals(isLikelyNewBookingRequest('sí, por favor'), false);
});
