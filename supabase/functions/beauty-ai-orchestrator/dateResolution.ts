import type { RecentMessage, ToolErrorCategory } from './types.ts';

export type TemporalContext = {
  timezone: string;
  nowUtc: string;
  localDate: string;
  localWeekday: string;
  minDate: string;
  maxDate: string;
  tomorrow: string;
  nextMonday: string;
};

export type DateResolution =
  | { status: 'resolved'; isoDate: string; label: string }
  | { status: 'not_understood' | 'past' | 'out_of_range'; isoDate: string | null };

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

const MONTH_INDEX: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function plain(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function dateAtUtcNoon(isoDate: string) {
  return new Date(`${isoDate}T12:00:00.000Z`);
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = dateAtUtcNoon(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function localDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function localWeekday(now: Date, timezone: string) {
  const value = new Intl.DateTimeFormat('es-ES', { timeZone: timezone, weekday: 'long' }).format(now);
  return value.toLowerCase();
}

function nextWeekday(from: string, target: number, forceNext: boolean) {
  const current = dateAtUtcNoon(from).getUTCDay();
  let delta = (target - current + 7) % 7;
  if (forceNext && delta === 0) delta = 7;
  return addDays(from, delta);
}

export function buildTemporalContext(now: Date, timezone: string, maxDays = 366): TemporalContext {
  const today = localDate(now, timezone);
  return {
    timezone,
    nowUtc: now.toISOString(),
    localDate: today,
    localWeekday: localWeekday(now, timezone),
    minDate: today,
    maxDate: addDays(today, maxDays),
    tomorrow: addDays(today, 1),
    nextMonday: nextWeekday(today, 1, true),
  };
}

function checked(candidate: string, label: string, context: TemporalContext): DateResolution {
  if (candidate < context.minDate) return { status: 'past', isoDate: candidate };
  if (candidate > context.maxDate) return { status: 'out_of_range', isoDate: candidate };
  return { status: 'resolved', isoDate: candidate, label };
}

function validCalendarDate(year: number, month: number, day: number) {
  const candidate = new Date(Date.UTC(year, month - 1, day, 12));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

export function resolveDateExpression(text: string, context: TemporalContext): DateResolution {
  const normalized = plain(text);
  if (/\bpasado\s+manana\b/.test(normalized)) {
    return checked(addDays(context.localDate, 2), 'pasado mañana', context);
  }
  // Accept the frequent mobile typo "nañana" in addition to "mañana".
  if (/\b(?:m|n)anana\b/.test(normalized)) return checked(context.tomorrow, 'mañana', context);
  if (/\bhoy\b/.test(normalized)) return checked(context.localDate, 'hoy', context);

  const isoMatch = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const candidate = `${year}-${month}-${day}`;
    if (!validCalendarDate(Number(year), Number(month), Number(day))) {
      return { status: 'not_understood', isoDate: null };
    }
    return checked(candidate, candidate, context);
  }

  const slashMatch = normalized.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    let year = slashMatch[3] ? Number(slashMatch[3]) : Number(context.localDate.slice(0, 4));
    if (!slashMatch[3]) {
      const currentMonthDay = context.localDate.slice(5);
      const candidateMonthDay = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (candidateMonthDay < currentMonthDay) year += 1;
    }
    if (!validCalendarDate(year, month, day)) return { status: 'not_understood', isoDate: null };
    const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return checked(candidate, `${day}/${month}${slashMatch[3] ? `/${year}` : ''}`, context);
  }

  const namedMonthMatch = normalized.match(
    /\b(?:el\s+)?(?:dia\s+)?(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?\b/,
  );
  if (namedMonthMatch) {
    const day = Number(namedMonthMatch[1]);
    const month = MONTH_INDEX[namedMonthMatch[2]];
    let year = namedMonthMatch[3]
      ? Number(namedMonthMatch[3])
      : Number(context.localDate.slice(0, 4));
    const monthDay = `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!namedMonthMatch[3] && monthDay < context.localDate.slice(5)) year += 1;
    if (!validCalendarDate(year, month, day)) return { status: 'not_understood', isoDate: null };
    return checked(`${year}-${monthDay}`, `${day} de ${namedMonthMatch[2]}`, context);
  }

  const dayOnlyMatch = normalized.match(/\b(?:el\s+)?dia\s+(\d{1,2})\b/);
  if (dayOnlyMatch) {
    const day = Number(dayOnlyMatch[1]);
    let year = Number(context.localDate.slice(0, 4));
    let month = Number(context.localDate.slice(5, 7));
    let candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!validCalendarDate(year, month, day) || candidate < context.localDate) {
      month += 1;
      if (month === 13) { month = 1; year += 1; }
      if (!validCalendarDate(year, month, day)) return { status: 'not_understood', isoDate: null };
      candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    return checked(candidate, `el día ${day}`, context);
  }

  const weekdayMatch = normalized.match(
    /\b(?:(este|el|proximo)\s+)?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/,
  );
  if (weekdayMatch) {
    const qualifier = weekdayMatch[1] ?? 'el';
    const weekday = weekdayMatch[2];
    const target = WEEKDAY_INDEX[weekday];
    const forceNext = qualifier === 'proximo' || qualifier === 'el';
    return checked(nextWeekday(context.localDate, target, forceNext), `${qualifier} ${weekday}`, context);
  }
  return { status: 'not_understood', isoDate: null };
}

export function detectRecentDateConflict(
  messages: RecentMessage[],
  context: TemporalContext,
  windowMs = 2 * 60 * 1000,
) {
  const inbound = messages.filter((message) =>
    message.direction === 'inbound' && message.sender_type === 'customer' && message.text_content?.trim()
  );
  if (inbound.length < 2) return null;
  const latest = inbound.at(-1)!;
  const previous = inbound.at(-2)!;
  if (new Date(latest.sent_at).getTime() - new Date(previous.sent_at).getTime() > windowMs) return null;
  const left = resolveDateExpression(previous.text_content!, context);
  const right = resolveDateExpression(latest.text_content!, context);
  if (left.status !== 'resolved' || right.status !== 'resolved' || left.isoDate === right.isoDate) return null;
  return {
    previous: left,
    latest: right,
    reply: `¿Prefieres ${right.label} o ${left.label}?`,
  };
}

export function temporalInstruction(context: TemporalContext) {
  return [
    `Fecha local actual: ${context.localDate}.`,
    `Día actual: ${context.localWeekday}.`,
    `Zona horaria: ${context.timezone}.`,
    `Mañana significa ${context.tomorrow}.`,
    `El lunes significa el próximo lunes posterior: ${context.nextMonday}.`,
    `Rango consultable: ${context.minDate} a ${context.maxDate}.`,
    'No inventes ni recalcules fechas absolutas. La aplicación valida y sustituye la fecha antes de consultar disponibilidad.',
  ].join('\n');
}

export function fallbackForToolError(category: ToolErrorCategory) {
  if (category === 'invalid_date') {
    return '¿Qué día te vendría bien? Puedes decirme, por ejemplo, mañana o el lunes.';
  }
  if (category === 'date_out_of_range') {
    return 'Solo puedo consultar citas dentro de las próximas semanas. ¿Qué fecha cercana prefieres?';
  }
  if (category === 'no_availability') {
    return 'No encuentro huecos para ese día. ¿Quieres que pruebe otra fecha?';
  }
  if (category === 'service_not_resolved') {
    return '¿Qué servicio te gustaría reservar?';
  }
  return 'Ahora mismo no puedo consultar la agenda. Te atenderá una persona en cuanto sea posible.';
}

export function sanitizeWhatsAppText(value: string) {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
}

export function spanishWeekdayNames() {
  return [...WEEKDAYS];
}
