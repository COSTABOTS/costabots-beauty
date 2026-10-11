export type ReminderDispatchContext = {
  conversationId: string;
  businessName: string;
  timezone: string;
  phone: string;
  instanceName: string;
  startsAt: string;
  serviceName: string;
  staffName: string | null;
};

export const REMINDER_MAX_ATTEMPTS = 3;

export function isRemindersDryRun(value: string | undefined) {
  return value?.trim().toLowerCase() !== 'false';
}

export function isCanonicalReminderPhone(value: string | null | undefined) {
  return /^\+[1-9]\d{7,14}$/.test(String(value ?? ''));
}

export function reminderClientRequestId(appointmentId: string, scheduleRevision: number) {
  return `reminder:${appointmentId}:day_before:r${scheduleRevision}`;
}

export function buildDayBeforeReminder(context: ReminderDispatchContext) {
  const time = new Intl.DateTimeFormat('es-ES', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: context.timezone,
  }).format(new Date(context.startsAt));
  const withStaff = context.staffName?.trim()
    ? ` con ${context.staffName.trim()}`
    : '';
  return `Hola, te recordamos que mañana tienes una cita en ${context.businessName} a las ${time} para ${context.serviceName}${withStaff}.`;
}

export function retryDelayMinutes(attemptCount: number) {
  if (attemptCount <= 1) return 5;
  if (attemptCount === 2) return 15;
  return 60;
}

export function retryDisposition(attemptCount: number, errorCode: string) {
  if (attemptCount >= REMINDER_MAX_ATTEMPTS) {
    return { status: 'failed' as const, errorCode, delayMinutes: null };
  }
  return { status: 'pending' as const, errorCode, delayMinutes: retryDelayMinutes(attemptCount) };
}

export function isClearlyPreDeliveryFailure(error: unknown) {
  return error instanceof TypeError || (error instanceof Error && error.message.includes('fetch'));
}
