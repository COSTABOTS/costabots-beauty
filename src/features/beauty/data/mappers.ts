import type { Appointment, AppointmentStatus, BeautyService, Customer, StaffMember, TimeBlock } from '../types';
import type {
  AppointmentEventRow,
  AppointmentRow,
  AppointmentService,
  AppointmentServiceRow,
  BusinessRow,
  CustomerRow,
  RepositoryBusiness,
  ScheduleRow,
  ServiceRow,
  StaffRow,
  StaffSchedule,
  StaffServiceAssignment,
  StaffServiceRow,
  TimeBlockRow,
} from './types';

const accents: StaffMember['accent'][] = ['coral', 'sage', 'sand'];

function formatInTimezone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

function maskPhone(phone: string) {
  const clean = phone.replace(/\s+/g, '');
  if (clean.length < 7) return 'Sin teléfono';
  return `${clean.slice(0, 5)} *** ${clean.slice(-3)}`;
}

function inferCategory(name: string): BeautyService['category'] {
  const normalized = name.toLocaleLowerCase('es');
  if (/manicura|pedicura|uña/.test(normalized)) return 'nails';
  if (/hombre|barba/.test(normalized)) return 'barber';
  return 'hair';
}

function mapSource(source: string): Appointment['source'] {
  if (source === 'whatsapp_ai') return 'WhatsApp IA';
  if (source === 'phone') return 'Teléfono';
  return 'Manual';
}

export function mapBusiness(row: BusinessRow): RepositoryBusiness {
  return { id: row.id, name: row.name, slug: row.slug, timezone: row.timezone, currency: row.default_currency, language: row.default_language };
}

export function mapStaff(rows: StaffRow[]): StaffMember[] {
  return rows.map((row, index) => ({
    id: row.id,
    name: row.display_name,
    role: 'Profesional',
    initials: row.display_name.split(' ').map((part) => part[0]).join('').slice(0, 2),
    accent: accents.includes(row.color_key as StaffMember['accent']) ? row.color_key as StaffMember['accent'] : accents[index % accents.length],
  }));
}

export function mapServices(rows: ServiceRow[]): BeautyService[] {
  return rows.map((row) => ({ id: row.id, name: row.name, durationMinutes: row.duration_minutes, price: Number(row.price), category: inferCategory(row.name) }));
}

export function mapStaffServices(rows: StaffServiceRow[], services: BeautyService[]): StaffServiceAssignment[] {
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  return rows.flatMap((row) => {
    const service = serviceMap.get(row.service_id);
    if (!service) return [];
    return [{
      id: row.id,
      staffId: row.staff_member_id,
      serviceId: row.service_id,
      durationMinutes: row.custom_duration_minutes ?? service.durationMinutes,
      price: row.custom_price === null ? service.price : Number(row.custom_price),
      active: row.active,
    }];
  });
}

export function mapSchedules(rows: ScheduleRow[]): StaffSchedule[] {
  return rows.map((row) => ({ id: row.id, staffId: row.staff_member_id, dayOfWeek: row.day_of_week, start: row.start_time.slice(0, 5), end: row.end_time.slice(0, 5), active: row.active }));
}

export function mapTimeBlocks(rows: TimeBlockRow[], timezone: string): TimeBlock[] {
  return rows.map((row) => {
    const start = formatInTimezone(row.starts_at, timezone);
    const end = formatInTimezone(row.ends_at, timezone);
    return { id: row.id, date: start.date, start: start.time, end: end.time, staffId: row.staff_member_id ?? 'all', reason: row.reason ?? (row.block_type === 'business_closed' ? 'Negocio cerrado' : 'Bloqueo') };
  });
}

export function mapAppointmentServices(rows: AppointmentServiceRow[]): AppointmentService[] {
  return rows.map((row) => ({ id: row.id, appointmentId: row.appointment_id, serviceId: row.service_id, staffId: row.staff_member_id, position: row.position, durationMinutes: row.duration_minutes, price: Number(row.price) }));
}

export function mapAppointments(rows: AppointmentRow[], appointmentServices: AppointmentService[], timezone: string): Appointment[] {
  const servicesByAppointment = new Map<string, AppointmentService[]>();
  appointmentServices.forEach((item) => servicesByAppointment.set(item.appointmentId, [...(servicesByAppointment.get(item.appointmentId) ?? []), item]));
  return rows.map((row) => {
    const start = formatInTimezone(row.starts_at, timezone);
    const end = formatInTimezone(row.ends_at, timezone);
    const linked = (servicesByAppointment.get(row.id) ?? []).sort((a, b) => a.position - b.position);
    return {
      id: row.id,
      date: start.date,
      start: start.time,
      end: end.time,
      customerId: row.customer_id,
      serviceId: linked[0]?.serviceId ?? '',
      serviceIds: linked.map((item) => item.serviceId),
      staffId: row.assigned_staff_member_id,
      status: row.status as AppointmentStatus,
      notes: row.customer_notes ?? row.internal_notes ?? undefined,
      source: mapSource(row.source),
      history: [],
      historyLoaded: false,
      totalDurationMinutes: row.total_duration_minutes,
      totalPrice: Number(row.total_price),
      currency: row.currency,
    };
  });
}

export function mapCustomers(rows: CustomerRow[], appointments: Appointment[], services: BeautyService[]): Customer[] {
  const serviceMap = new Map(services.map((service) => [service.id, service]));
  return rows.map((row) => {
    const related = appointments.filter((appointment) => appointment.customerId === row.id).sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
    const completed = related.filter((appointment) => appointment.status === 'completed');
    const upcoming = related.find((appointment) => !['completed', 'cancelled', 'no_show'].includes(appointment.status));
    const serviceNames = [...new Set(related.map((appointment) => serviceMap.get(appointment.serviceId)?.name).filter((name): name is string => Boolean(name)))];
    const phone = row.phone ?? '';
    return {
      id: row.id,
      name: [row.first_name, row.last_name].filter(Boolean).join(' '),
      phone,
      maskedPhone: maskPhone(phone),
      lastVisit: completed[completed.length - 1]?.date ?? 'Sin visitas',
      recommendedService: serviceNames[0] ?? 'Sin sugerencia',
      nextAppointmentId: upcoming?.id,
      recurrent: related.length > 1,
      preferredStaffId: row.preferred_staff_member_id ?? undefined,
      notes: row.notes ?? '',
      messagingConsent: row.marketing_consent || row.reminder_consent,
      nextReactivation: 'Pendiente de configurar',
      usualServices: serviceNames.length ? serviceNames : ['Sin historial'],
      appointmentCount: related.length,
    };
  });
}

const eventLabels: Record<string, string> = {
  created: 'Cita creada',
  updated: 'Cita actualizada',
  status_changed: 'Estado actualizado',
  rescheduled: 'Cita reprogramada',
  cancelled: 'Cita cancelada',
  note_added: 'Nota añadida',
};

export function mapAppointmentEvents(rows: AppointmentEventRow[], timezone: string) {
  return rows.map((row) => {
    const date = formatInTimezone(row.created_at, timezone);
    return { id: row.id, label: eventLabels[row.event_type] ?? 'Actividad registrada', at: `${date.date} · ${date.time}` };
  });
}
