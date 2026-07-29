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

export type WritableAppointmentStatus =
  | 'pending'
  | 'confirmed'
  | 'arrived'
  | 'in_service'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export type BeautyTimeBlockType =
  | 'break'
  | 'absence'
  | 'vacation'
  | 'personal'
  | 'business_closed'
  | 'other';

export type UpdateAppointmentStatusCommand = {
  appointmentId: string;
  status: WritableAppointmentStatus;
};

export type CreateTimeBlockCommand = {
  staffId: string | null;
  date: string;
  start: string;
  end: string;
  type: BeautyTimeBlockType;
  reason: string;
  notes?: string;
};

export type AvailabilityCommand = {
  serviceIds: string[];
  date: string;
  staffId: string;
  excludeAppointmentId?: string;
};

export type AvailabilitySlot = {
  staffId: string;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
};

export type CreateAppointmentCommand = {
  customerId: string;
  staffId: string;
  serviceIds: string[];
  startsAt: string;
  customerNotes?: string;
  internalNotes?: string;
};

export type UpdateAppointmentCommand = {
  appointmentId: string;
  staffId: string;
  serviceIds: string[];
  startsAt: string;
  internalNotes: string;
};

export type CancelAppointmentCommand = {
  appointmentId: string;
  reason: string;
};

export type UpdateTimeBlockCommand = CreateTimeBlockCommand & { blockId: string };
export type DeactivateTimeBlockCommand = { blockId: string };

export type CustomerInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  preferredStaffId: string | null;
  notes: string;
  reminderConsent: boolean;
  marketingConsent: boolean;
};

export type CreateCustomerCommand = CustomerInput;

export type UpdateCustomerCommand = CustomerInput & {
  customerId: string;
  active: boolean;
};

export type DeactivateCustomerCommand = {
  customerId: string;
};

export type CustomerHistory = {
  appointments: Appointment[];
  appointmentServices: AppointmentService[];
};

export type StaffInput = {
  name: string;
  phone: string;
  email: string;
  colorKey: 'coral' | 'sage' | 'sand';
  sortOrder: number;
};
export type CreateStaffCommand = StaffInput;
export type UpdateStaffCommand = StaffInput & { staffId: string; active: boolean };
export type DeactivateStaffCommand = { staffId: string };

export type ServiceInput = {
  name: string;
  description: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  price: number;
  currency: string;
  onlineBookingEnabled: boolean;
  reactivationDays: number | null;
};
export type CreateServiceCommand = ServiceInput;
export type UpdateServiceCommand = ServiceInput & { serviceId: string; active: boolean };
export type DeactivateServiceCommand = { serviceId: string };

export type SetStaffServiceCommand = {
  staffId: string;
  serviceId: string;
  durationMinutes: number | null;
  price: number | null;
  active: boolean;
};
export type WeeklyScheduleSegmentInput = { dayOfWeek: number; start: string; end: string };
export type ReplaceWeeklyScheduleCommand = { staffId: string; segments: WeeklyScheduleSegmentInput[] };

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
  phone: string | null;
  email: string | null;
  color_key: string;
  sort_order: number;
  active: boolean;
};

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price: number | string;
  currency: string;
  active: boolean;
  online_booking_enabled: boolean;
  reactivation_days: number | null;
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
  phone_normalized: string | null;
  email: string | null;
  preferred_staff_member_id: string | null;
  notes: string | null;
  marketing_consent: boolean;
  reminder_consent: boolean;
  consent_updated_at: string | null;
  active: boolean;
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
