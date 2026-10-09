import type {
  BookingInterpretation,
  BookingSession,
  BookingStatus,
  OfferedTime,
} from './bookingTypes.ts';
import { resolveDateExpression } from './dateResolution.ts';
import type { TemporalContext } from './dateResolution.ts';

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function canonicalTime(hour: number, minute: number) {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function withAfternoon(hour: number, text: string) {
  return /\b(de\s+la\s+tarde|por\s+la\s+tarde)\b/.test(text) && hour < 12
    ? hour + 12
    : hour;
}

const NUMBER_WORDS: Record<string, number> = {
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
};

function optionReference(rawText: string): BookingInterpretation['option_reference'] {
  const text = normalizeText(rawText);
  if (/\b(primera|primero)\b/.test(text)) return 'first';
  if (/\b(segunda|segundo)\b/.test(text)) return 'second';
  if (/\b(ultima|ultimo)\b/.test(text)) return 'last';
  if (/\b(esa|ese)\b/i.test(text)) return 'that';
  return null;
}

function timeFromText(value: string, allowBareHour = true) {
  const normalized = normalizeText(value);
  // Keep this anchored: an invalid "9 y 75" must not fall through and silently
  // become 09:00 because the generic parser saw only its first number.
  const numericMinutePhrase = normalized.match(/^(?:a\s+las?\s+|las?\s+)?(\d{1,2})\s+y\s+(\d{1,2})$/);
  if (numericMinutePhrase) {
    return canonicalTime(
      withAfternoon(Number(numericMinutePhrase[1]), normalized),
      Number(numericMinutePhrase[2]),
    );
  }
  const numericNatural = normalized.match(/\b(?:a\s+las?|las?)?\s*(\d{1,2})\s+(y\s+(?:cuarto|media)|menos\s+cuarto)\b/);
  if (numericNatural) {
    let hour = withAfternoon(Number(numericNatural[1]), normalized);
    const qualifier = numericNatural[2];
    if (qualifier === 'menos cuarto') hour = (hour + 23) % 24;
    return canonicalTime(hour, qualifier === 'y media' ? 30 : qualifier === 'y cuarto' ? 15 : 45);
  }
  const wordNatural = normalized.match(/\b(?:a\s+las?|las?)?\s*(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+(y\s+(?:cuarto|media)|menos\s+cuarto)\b/);
  if (wordNatural) {
    let hour = withAfternoon(NUMBER_WORDS[wordNatural[1]], normalized);
    const qualifier = wordNatural[2];
    if (qualifier === 'menos cuarto') hour = (hour + 23) % 24;
    return canonicalTime(hour, qualifier === 'y media' ? 30 : qualifier === 'y cuarto' ? 15 : 45);
  }
  const numeric = normalized.match(allowBareHour
    ? /\b(?:a\s+las?|las?)?\s*(\d{1,2})(?::([0-5]\d))?\b/
    : /\b(?:a\s+las?|las?)\s*(\d{1,2})(?::([0-5]\d))?\b|\b(\d{1,2}):([0-5]\d)\b/);
  if (numeric) {
    const hour = withAfternoon(Number(numeric[1] ?? numeric[3]), normalized);
    return canonicalTime(hour, Number(numeric[2] ?? numeric[4] ?? 0));
  }
  const words = normalized.match(/\b(?:a\s+las?|las?)?\s*(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/);
  if (!words) return null;
  const hour = withAfternoon(NUMBER_WORDS[words[1]], normalized);
  return canonicalTime(hour, 0);
}

export function resolveTimeExpression(
  rawText: string,
  interpretation: BookingInterpretation,
  session: BookingSession | null,
) {
  const options = session?.offered_times ?? [];
  const reference = interpretation.option_reference ?? optionReference(rawText);
  if (reference === 'first') return options[0] ?? null;
  if (reference === 'second') return options[1] ?? null;
  if (reference === 'last') return options.at(-1) ?? null;
  if (reference === 'that') {
    const selected = options.find((option) => option.starts_at === session?.selected_starts_at);
    if (selected) return selected;
    if (options.length === 1) return options[0];
  }

  const label = timeFromText(
    interpretation.time_expression ?? rawText,
    session?.status === 'choosing_time' || session?.status === 'awaiting_confirmation',
  );
  return label ? options.find((option) => option.label === label) ?? null : null;
}

export function normalizeRequestedTime(rawText: string, interpretation: BookingInterpretation, allowBareHour = true) {
  return timeFromText(interpretation.time_expression ?? rawText, allowBareHour);
}

function baseInterpretation(intent: BookingInterpretation['intent']): BookingInterpretation {
  return {
    intent,
    service_reference: null,
    date_expression: null,
    time_expression: null,
    option_reference: null,
    confirmation: null,
    wants_human: false,
    confidence: 1,
  };
}

export function isExistingAppointmentCancellation(rawText: string) {
  const text = normalizeText(rawText);
  return /\b(cancelar|cancelo|cancela|cancelacion|anular|anulo|anula)\b/.test(text)
    && /\b(cita|reserva|turno)\b/.test(text);
}

export function isExistingAppointmentReschedule(rawText: string) {
  const text = normalizeText(rawText);
  return /\b(cambiar|cambio|modificar|reprogramar|mover|adelantar|retrasar)\b/.test(text)
    && /\b(cita|reserva|turno|hora|fecha|dia)\b/.test(text);
}

export function isSocialMessage(rawText: string) {
  return /^(?:muchas\s+)?gracias[!.\s]*$/i.test(normalizeText(rawText));
}

export function isOutOfDomainMessage(rawText: string) {
  const text = normalizeText(rawText);
  return /\b(playa|viaje|viajar|futbol|pelicula|receta|meteorologico|clima)\b/.test(text);
}

export function interpretBookingDeterministically(
  rawText: string,
  status: BookingStatus | null,
  services: Array<{ id: string; name: string }>,
  temporal: TemporalContext,
  session: BookingSession | null = null,
): BookingInterpretation | null {
  const text = normalizeText(rawText);
  if (/\b(persona|humano|humana|agente|encargad[oa])\b/.test(text)) {
    return { ...baseInterpretation('request_human'), wants_human: true };
  }
  if (isExistingAppointmentCancellation(rawText)) {
    return baseInterpretation('cancel_existing');
  }
  if (isExistingAppointmentReschedule(rawText)) {
    return baseInterpretation('reschedule_existing');
  }
  if (isSocialMessage(rawText)) return baseInterpretation('social');
  if (isOutOfDomainMessage(rawText)) return baseInterpretation('out_of_domain');

  const service = services.find(({ name }) => {
    const normalizedName = normalizeText(name);
    return normalizedName.length > 1 && (text.includes(normalizedName) || normalizedName.includes(text));
  });
  const date = resolveDateExpression(rawText, temporal);
  const time = timeFromText(rawText, status === 'choosing_time' || status === 'awaiting_confirmation');
  const option = optionReference(rawText);
  const staffId = resolveStaffReference(rawText, session);
  const affirmative = /^(si|sí|vale|de acuerdo|confirmo|reserva(?:la)?|reservala)(?:[\s,]+(esa|ese))?$/i.test(rawText.trim());
  const reject = /^(no|cancelar|cancela|dejalo|déjalo)$/i.test(rawText.trim());

  if (service) {
    return {
      ...baseInterpretation('choose_service'),
      service_reference: service.name,
      date_expression: date.status === 'resolved' ? rawText : null,
      time_expression: time,
      option_reference: option,
    };
  }
  if (staffId) {
    const staff = session?.offered_times.find((option) => option.staff_id === staffId);
    return {
      ...baseInterpretation('change_selection'),
      staff_reference: staff?.staff_display_name ?? rawText,
    };
  }
  if (date.status === 'resolved') {
    return {
      ...baseInterpretation('choose_date'),
      date_expression: rawText,
      time_expression: time,
      option_reference: option,
    };
  }
  if (status === 'awaiting_confirmation' && affirmative) {
    return { ...baseInterpretation('confirm'), confirmation: true };
  }
  if (status === 'choosing_time' || status === 'awaiting_confirmation') {
    if (time || option) {
      return {
        ...baseInterpretation('choose_time'),
        time_expression: time,
        option_reference: option,
      };
    }
    if (affirmative) return { ...baseInterpretation('confirm'), confirmation: true };
    if (reject) return { ...baseInterpretation('reject'), confirmation: false };
  }
  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches)\b/.test(text)) {
    return baseInterpretation('unknown');
  }
  if (/\b(precio|cuanto|cuánto|duracion|duración|direccion|dirección|horario|servicios)\b/.test(text)) {
    return baseInterpretation('ask_information');
  }
  return null;
}

export function resolveRequestedDate(
  rawText: string,
  interpretation: BookingInterpretation,
  temporal: TemporalContext,
) {
  const deterministic = resolveDateExpression(rawText, temporal);
  if (deterministic.status !== 'not_understood') return deterministic;
  const interpreted = interpretation.date_expression?.trim();
  return interpreted ? resolveDateExpression(interpreted, temporal) : deterministic;
}

export function deterministicDateOverride(
  status: BookingStatus | null,
  rawText: string,
  temporal: TemporalContext,
) {
  if (status !== 'choosing_date') return null;
  const resolution = resolveDateExpression(rawText, temporal);
  if (!['resolved', 'window', 'inconsistent'].includes(resolution.status)) return null;
  return {
    resolution,
    interpretation: {
      intent: 'choose_date',
      service_reference: null,
      date_expression: rawText,
      time_expression: null,
      option_reference: null,
      confirmation: null,
      wants_human: false,
      confidence: 1,
    } satisfies BookingInterpretation,
  };
}

export function resolveServiceReference(
  reference: string | null,
  services: Array<{ id: string; name: string }>,
) {
  if (!reference) return null;
  const wanted = normalizeText(reference);
  const exact = services.find((service) => normalizeText(service.name) === wanted);
  if (exact) return exact.id;
  return null;
}

export function resolveStaffReference(reference: string | null | undefined, session: BookingSession | null) {
  const wanted = normalizeText(reference ?? '').replace(/^(?:con|la|el)\s+/, '');
  if (!wanted || !session) return null;
  const matches = session.offered_times.filter((option) =>
    option.staff_display_name && normalizeText(option.staff_display_name).includes(wanted)
  );
  const staffIds = [...new Set(matches.map((option) => option.staff_id))];
  return staffIds.length === 1 ? staffIds[0] : null;
}

export function optionStillOffered(selected: OfferedTime, options: OfferedTime[]) {
  return options.some((option) =>
    option.starts_at === selected.starts_at && option.staff_id === selected.staff_id
  );
}

export function isAffirmative(rawText: string, interpretation: BookingInterpretation) {
  if (interpretation.confirmation === true) return true;
  const text = rawText.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
  return /^(si|vale|perfecto|adelante|de acuerdo|confirmo|confirma(?:la)?|reserva(?:la)?|quiero esa)(?:[\s,]+(cita|esa|ese))?$/i.test(text);
}
