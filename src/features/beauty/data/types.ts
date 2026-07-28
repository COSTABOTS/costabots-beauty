import type {
  Appointment,
  AppointmentHistoryItem,
  BeautyService,
  Customer,
  StaffMember,
  TimeBlock,
} from '../types';

export type DateRange = {
  from: string;
  to: string;
};

export type RepositoryBusiness = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  language: string;
};

export type StaffServiceAssignment = {
  id: string;
  staffId: string;
  serviceId: string;
  durationMinutes: number;
  price: number;
  active: boolean;
};

export type StaffSchedule = {
  id: string;
  staffId: string;
  dayOfWeek: number;
  start: string;
  end: string;
  active: boolean;
};

export type AppointmentService = {
  id: string;
  appointmentId: string;
  serviceId: string;
  staffId: string;
  position: number;
  durationMinutes: number;
  price: number;
};

export type BeautyOperationalData = {
  business: RepositoryBusiness;
  staff: StaffMember[];
  services: BeautyService[];
  staffServices: StaffServiceAssignment[];
  schedules: StaffSchedule[];
  timeBlocks: TimeBlock[];
  customers: Customer[];
  appointments: Appointment[];
  appointmentServices: AppointmentService[];
};

export type OperationalCounts = {
  staff: number;
  services: number;
  customers: number;
  appointments: number;
};

export type AppointmentEvent = AppointmentHistoryItem;

export type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  default_currency: string;
  default_language: string;
};

export type StaffRow = {
  id: string;
  display_name: string;
  color_key: string;
  sort_order: number;
};

export type ServiceRow = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number | string;
  currency: string;
};

export type StaffServiceRow = {
  id: string;
  staff_member_id: string;
  service_id: string;
  custom_duration_minutes: number | null;
  custom_price: number | string | null;
  active: boolean;
};

export type ScheduleRow = {
  id: string;
  staff_member_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  active: boolean;
};

export type TimeBlockRow = {
  id: string;
  staff_member_id: string | null;
  starts_at: string;
  ends_at: string;
  block_type: string;
  reason: string | null;
};

export type CustomerRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  phone: string | null;
  preferred_staff_member_id: string | null;
  notes: string | null;
  marketing_consent: boolean;
  reminder_consent: boolean;
};

export type AppointmentRow = {
  id: string;
  customer_id: string;
  starts_at: string;
  ends_at: string;
  status: Appointment['status'];
  source: string;
  customer_notes: string | null;
  internal_notes: string | null;
  total_duration_minutes: number;
  total_price: number | string;
  currency: string;
  assigned_staff_member_id: string;
};

export type AppointmentServiceRow = {
  id: string;
  appointment_id: string;
  service_id: string;
  staff_member_id: string;
  position: number;
  duration_minutes: number;
  price: number | string;
};

export type AppointmentEventRow = {
  id: string;
  event_type: string;
  source: string;
  created_at: string;
};
