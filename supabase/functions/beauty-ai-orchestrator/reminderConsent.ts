export const reminderConsentPrompt = '¿Quieres que te recuerde tus citas por WhatsApp el día anterior?';
export const reminderConsentGrantedReply = 'Perfecto, te recordaré tus citas por WhatsApp el día anterior.';
export const reminderConsentDeniedReply = 'De acuerdo, no te enviaré recordatorios de citas.';
export const reminderConsentDeferredReply = 'Sin problema. Puedes decírmelo más adelante.';

export type ReminderConsentChoice = 'granted' | 'denied' | 'defer';

export function shouldAskReminderConsent(
  consentStatus: string | null | undefined,
  reminderStatus: string | null | undefined,
) {
  return consentStatus === 'unknown' && reminderStatus === 'awaiting_consent';
}

export function isLikelyNewBookingRequest(text: string) {
  const value = normalized(text);
  return /\b(cita|reserv(?:a|ar)|pedir(?:\s+una)?\s+cita|corte|tinte|peinar|pelar(?:me)?|cortar(?:me)?)\b/.test(value);
}

function normalized(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/[!.]+$/g, '').trim();
}

export function resolveReminderConsentChoice(text: string): ReminderConsentChoice {
  const value = normalized(text);
  if (/^(si|vale|claro|perfecto|de acuerdo|por supuesto|si,? por favor)$/.test(value)) return 'granted';
  if (/^(no|no gracias|prefiero que no|mejor no)$/.test(value)) return 'denied';
  return 'defer';
}
