import type {
  AppointmentEvent,
  AppointmentService,
  BeautyOperationalData,
  DateRange,
  RepositoryBusiness,
  StaffSchedule,
  StaffServiceAssignment,
} from './types';
import type { Appointment, BeautyService, Customer, StaffMember, TimeBlock } from '../types';

export interface BeautyRepository {
  getBusiness(businessId: string): Promise<RepositoryBusiness>;
  getStaff(businessId: string): Promise<StaffMember[]>;
  getServices(businessId: string): Promise<BeautyService[]>;
  getStaffServices(businessId: string): Promise<StaffServiceAssignment[]>;
  getSchedules(businessId: string): Promise<StaffSchedule[]>;
  getTimeBlocks(businessId: string, range: DateRange, timezone: string): Promise<TimeBlock[]>;
  getCustomers(businessId: string): Promise<Customer[]>;
  getAppointments(businessId: string, range: DateRange, timezone: string): Promise<Appointment[]>;
  getAppointmentServices(businessId: string, appointmentIds: string[]): Promise<AppointmentService[]>;
  getAppointmentEvents(businessId: string, appointmentId: string, timezone: string): Promise<AppointmentEvent[]>;
  getOperationalData(businessId: string, range: DateRange): Promise<BeautyOperationalData>;
}

export class BeautyRepositoryError extends Error {
  constructor(message = 'No hemos podido cargar los datos del negocio.') {
    super(message);
    this.name = 'BeautyRepositoryError';
  }
}
