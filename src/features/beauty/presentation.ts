import type { Appointment } from './types';

const activeAppointmentStatuses = new Set<Appointment['status']>([
  'pending',
  'confirmed',
  'arrived',
  'in_service',
]);

export function selectNextAppointment(
  appointments: Appointment[],
  currentTime: string,
) {
  return [...appointments]
    .filter((appointment) => activeAppointmentStatuses.has(appointment.status) && appointment.end > currentTime)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
}

export function formatMoney(value: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: currency || 'EUR',
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value} ${currency || 'EUR'}`;
  }
}

export function formatAppointmentSource(source: Appointment['source']) {
  const labels: Record<Appointment['source'], string> = {
    Manual: 'Creada manualmente',
    'WhatsApp IA': 'WhatsApp',
    'Teléfono': 'Teléfono',
  };
  return labels[source];
}

export function formatMessageTime(value: string, timezone = 'Europe/Madrid') {
  try {
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  }
}

export function formatMessageDateTime(value: string, timezone = 'Europe/Madrid') {
  try {
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: timezone,
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: 'Europe/Madrid',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  }
}
