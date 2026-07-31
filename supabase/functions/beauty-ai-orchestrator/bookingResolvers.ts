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

function timeFromText(value: string) {
  const normalized = normalizeText(value);
  const numeric = normalized.match(/\b(?:a\s+las?|las?)?\s*(\d{1,2})(?::([0-5]\d))?\b/);
  if (numeric) {
    let hour = Number(numeric[1]);
    if (/\b(de\s+la\s+tarde|por\s+la\s+tarde)\b/.test(normalized) && hour < 12) hour += 12;
    return canonicalTime(hour, Number(numeric[2] ?? 0));
  }
  const words = normalized.match(/\b(?:a\s+las?|las?)?\s*(una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/);
  if (!words) return null;
  let hour = NUMBER_WORDS[words[1]];
  if (/\b(de\s+la\s+tarde|por\s+la\s+tarde)\b/.test(normalized) && hour < 12) hour += 12;
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

  const label = timeFromText(interpretation.time_expression ?? rawText);
  return label ? options.find((option) => option.label === label) ?? null : null;
}

export function normalizeRequestedTime(rawText: string, interpretation: BookingInterpretation) {
  return timeFromText(interpretation.time_expression ?? rawText);
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

export function interpretBookingDeterministically(
  rawText: string,
  status: BookingStatus | null,
  services: Array<{ id: string; name: string }>,
  temporal: TemporalContext,
): BookingInterpretation | null {
  const text = normalizeText(rawText);
  if (/\b(persona|humano|humana|agente|encargad[oa])\b/.test(text)) {
    return { ...baseInterpretation('request_human'), wants_human: true };
  }

  const service = services.find(({ name }) => {
    const normalizedName = normalizeText(name);
    return normalizedName.length > 1 && (text.includes(normalizedName) || normalizedName.includes(text));
  });
  const date = resolveDateExpression(rawText, temporal);
  const time = timeFromText(rawText);
  const option = optionReference(rawText);
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
  if (resolution.status !== 'resolved') return null;
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
  const partial = services.filter((service) =>
    normalizeText(service.name).includes(wanted) || wanted.includes(normalizeText(service.name))
  );
  return partial.length === 1 ? partial[0].id : null;
}

export function optionStillOffered(selected: OfferedTime, options: OfferedTime[]) {
  return options.some((option) =>
    option.starts_at === selected.starts_at && option.staff_id === selected.staff_id
  );
}

export function isAffirmative(rawText: string, interpretation: BookingInterpretation) {
  if (interpretation.confirmation === true) return true;
  return /^(si|sí|vale|de acuerdo|confirmo|reserva(?:la)?|reservala)(?:[\s,]+(esa|ese))?$/i.test(rawText.trim());
}
