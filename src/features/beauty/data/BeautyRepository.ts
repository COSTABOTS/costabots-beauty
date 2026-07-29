import type {
  AppointmentEvent,
  AppointmentService,
  BeautyOperationalData,
  DateRange,
  RepositoryBusiness,
  StaffSchedule,
  StaffServiceAssignment,
  AvailabilityCommand,
  AvailabilitySlot,
  CreateAppointmentCommand,
  CreateCustomerCommand,
  CreateTimeBlockCommand,
  CustomerHistory,
  CreateServiceCommand,
  CreateStaffCommand,
  DeactivateCustomerCommand,
  DeactivateServiceCommand,
  DeactivateStaffCommand,
  ReplaceWeeklyScheduleCommand,
  SetStaffServiceCommand,
  UpdateAppointmentStatusCommand,
  UpdateCustomerCommand,
  UpdateServiceCommand,
  UpdateStaffCommand,
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
  getCustomerHistory(businessId: string, customerId: string, timezone: string): Promise<CustomerHistory>;
  getAppointments(businessId: string, range: DateRange, timezone: string): Promise<Appointment[]>;
  getAppointmentServices(businessId: string, appointmentIds: string[]): Promise<AppointmentService[]>;
  getAppointmentEvents(businessId: string, appointmentId: string, timezone: string): Promise<AppointmentEvent[]>;
  getOperationalData(businessId: string, range: DateRange): Promise<BeautyOperationalData>;
  updateAppointmentStatus(businessId: string, command: UpdateAppointmentStatusCommand): Promise<string>;
  createTimeBlock(businessId: string, timezone: string, command: CreateTimeBlockCommand): Promise<string>;
  getAvailability(businessId: string, command: AvailabilityCommand): Promise<AvailabilitySlot[]>;
  createAppointment(businessId: string, command: CreateAppointmentCommand): Promise<string>;
  createCustomer(businessId: string, command: CreateCustomerCommand): Promise<string>;
  updateCustomer(businessId: string, command: UpdateCustomerCommand): Promise<string>;
  deactivateCustomer(businessId: string, command: DeactivateCustomerCommand): Promise<string>;
  createStaff(businessId: string, command: CreateStaffCommand): Promise<string>;
  updateStaff(businessId: string, command: UpdateStaffCommand): Promise<string>;
  deactivateStaff(businessId: string, command: DeactivateStaffCommand): Promise<string>;
  createService(businessId: string, command: CreateServiceCommand): Promise<string>;
  updateService(businessId: string, command: UpdateServiceCommand): Promise<string>;
  deactivateService(businessId: string, command: DeactivateServiceCommand): Promise<string>;
  setStaffService(businessId: string, command: SetStaffServiceCommand): Promise<string>;
  replaceWeeklySchedule(businessId: string, command: ReplaceWeeklyScheduleCommand): Promise<void>;
}

export class BeautyRepositoryError extends Error {
  code: 'conflict' | 'permission' | 'session' | 'invalid' | 'network' | 'not_found' | 'unknown';

  constructor(message = 'No hemos podido cargar los datos del negocio.', code: BeautyRepositoryError['code'] = 'unknown') {
    super(message);
    this.name = 'BeautyRepositoryError';
    this.code = code;
  }
}
