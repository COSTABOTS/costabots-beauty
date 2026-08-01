const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeAvailabilityDate(value: unknown) {
  const raw = value instanceof Date ? value.toISOString() : String(value ?? '').trim();
  const normalized = DATE_PATTERN.test(raw) ? raw : raw.match(/^(\d{4}-\d{2}-\d{2})T/)?.[1] ?? '';
  if (!DATE_PATTERN.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new Error('INVALID_AVAILABILITY_DATE');
  }
  return normalized;
}

export function buildAvailabilityRpcArgs(input: {
  businessId: string;
  serviceId: string;
  date: unknown;
  staffId?: string | null;
  slotIntervalMinutes?: number;
}) {
  if (!UUID_PATTERN.test(input.businessId) || !UUID_PATTERN.test(input.serviceId)) {
    throw new Error('INVALID_AVAILABILITY_ID');
  }
  const args: Record<string, unknown> = {
    p_business_id: input.businessId,
    p_service_id: input.serviceId,
    p_date: normalizeAvailabilityDate(input.date),
    p_slot_interval_minutes: input.slotIntervalMinutes ?? 15,
  };
  if (input.staffId) {
    if (!UUID_PATTERN.test(input.staffId)) throw new Error('INVALID_AVAILABILITY_ID');
    // Exact SQL signature: get_beauty_ai_availability(..., p_staff_member_id, ...).
    args.p_staff_member_id = input.staffId;
  }
  return args;
}

type AvailabilityRow = {
  staff_member_id: string;
  staff_display_name: string;
  starts_at: string;
  ends_at: string;
  available: boolean;
};

function localDateTime(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`;
}

export function availabilityRowsToSlots(rows: AvailabilityRow[], timezone: string) {
  return rows.filter((row) => row.available)
    .sort((left, right) => left.starts_at.localeCompare(right.starts_at))
    .map((row) => ({
      startsAt: row.starts_at,
      endsAt: localDateTime(row.ends_at, timezone),
      label: localDateTime(row.starts_at, timezone).slice(-5),
      timezone,
      staffId: row.staff_member_id,
      professional: row.staff_display_name,
    }));
}
