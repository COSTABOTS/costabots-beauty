import type { DateRange } from './types';

export function dateInTimeZone(timezone: string, instant = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function addCalendarDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function startOfIsoWeek(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  const day = value.getUTCDay() || 7;
  return addCalendarDays(date, 1 - day);
}

export function weekRange(date: string): DateRange {
  const from = startOfIsoWeek(date);
  return { from, to: addCalendarDays(from, 7) };
}

export function dayRange(date: string): DateRange {
  return { from: date, to: addCalendarDays(date, 1) };
}

export function rangeContains(range: DateRange, date: string) {
  return date >= range.from && date < range.to;
}

export function formatBusinessDate(date: string, timezone: string, includeYear = false) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(includeYear ? { year: 'numeric' as const } : {}),
  }).format(new Date(`${date}T12:00:00Z`));
}

export function formatWeekLabel(range: DateRange, timezone: string) {
  const end = addCalendarDays(range.to, -1);
  const startDate = new Date(`${range.from}T12:00:00Z`);
  const endDate = new Date(`${end}T12:00:00Z`);
  const start = new Intl.DateTimeFormat('es-ES', { timeZone: timezone, day: 'numeric', month: 'short' }).format(startDate);
  const finish = new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(endDate);
  return `${start} – ${finish}`;
}
