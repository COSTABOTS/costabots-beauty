import { supabase } from '../../../lib/supabaseClient';
import type { Customer } from '../types';
import { BeautyRepositoryError, type BeautyRepository } from './BeautyRepository';
import {
  mapAppointmentEvents,
  mapAppointments,
  mapAppointmentServices,
  mapBusiness,
  mapCustomers,
  mapSchedules,
  mapServices,
  mapStaff,
  mapStaffServices,
  mapTimeBlocks,
} from './mappers';
import type {
  AppointmentEventRow,
  AppointmentRow,
  AppointmentServiceRow,
  BusinessRow,
  CustomerRow,
  DateRange,
  ScheduleRow,
  ServiceRow,
  StaffRow,
  StaffServiceRow,
  TimeBlockRow,
} from './types';

function ensureData<T>(data: T | null, error: { message: string } | null, message: string): T {
  if (error || data === null) throw new BeautyRepositoryError(message);
  return data;
}

async function fetchCustomerRows(businessId: string) {
  const result = await supabase
    .from('customers')
    .select('id,first_name,last_name,phone,preferred_staff_member_id,notes,marketing_consent,reminder_consent')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('first_name');
  return ensureData(result.data as CustomerRow[] | null, result.error, 'No hemos podido cargar los clientes.');
}

async function fetchAppointmentRows(businessId: string, range: DateRange) {
  const result = await supabase
    .from('appointments')
    .select('id,customer_id,starts_at,ends_at,status,source,customer_notes,internal_notes,total_duration_minutes,total_price,currency,assigned_staff_member_id')
    .eq('business_id', businessId)
    .gte('starts_at', `${range.from}T00:00:00Z`)
    .lt('starts_at', `${range.to}T00:00:00Z`)
    .order('starts_at');
  return ensureData(result.data as AppointmentRow[] | null, result.error, 'No hemos podido cargar la agenda.');
}

export const supabaseBeautyRepository: BeautyRepository = {
  async getBusiness(businessId) {
    const result = await supabase
      .from('beauty_businesses')
      .select('id,name,slug,timezone,default_currency,default_language')
      .eq('id', businessId)
      .eq('active', true)
      .single();
    return mapBusiness(ensureData(result.data as BusinessRow | null, result.error, 'No hemos podido cargar el negocio.'));
  },

  async getStaff(businessId) {
    const result = await supabase
      .from('staff_members')
      .select('id,display_name,color_key,sort_order')
      .eq('business_id', businessId)
      .eq('active', true)
      .order('sort_order');
    return mapStaff(ensureData(result.data as StaffRow[] | null, result.error, 'No hemos podido cargar los profesionales.'));
  },

  async getServices(businessId) {
    const result = await supabase
      .from('beauty_services')
      .select('id,name,duration_minutes,price,currency')
      .eq('business_id', businessId)
      .eq('active', true)
      .order('name');
    return mapServices(ensureData(result.data as ServiceRow[] | null, result.error, 'No hemos podido cargar los servicios.'));
  },

  async getStaffServices(businessId) {
    const [rowsResult, services] = await Promise.all([
      supabase.from('staff_services').select('id,staff_member_id,service_id,custom_duration_minutes,custom_price,active').eq('business_id', businessId).eq('active', true),
      this.getServices(businessId),
    ]);
    const rows = ensureData(rowsResult.data as StaffServiceRow[] | null, rowsResult.error, 'No hemos podido cargar la asignación de servicios.');
    return mapStaffServices(rows, services);
  },

  async getSchedules(businessId) {
    const result = await supabase
      .from('staff_schedules')
      .select('id,staff_member_id,day_of_week,start_time,end_time,active')
      .eq('business_id', businessId)
      .eq('active', true)
      .order('day_of_week')
      .order('start_time');
    return mapSchedules(ensureData(result.data as ScheduleRow[] | null, result.error, 'No hemos podido cargar los horarios.'));
  },

  async getTimeBlocks(businessId, range, timezone) {
    const result = await supabase
      .from('time_blocks')
      .select('id,staff_member_id,starts_at,ends_at,block_type,reason')
      .eq('business_id', businessId)
      .lt('starts_at', `${range.to}T00:00:00Z`)
      .gt('ends_at', `${range.from}T00:00:00Z`)
      .order('starts_at');
    return mapTimeBlocks(ensureData(result.data as TimeBlockRow[] | null, result.error, 'No hemos podido cargar los bloqueos.'), timezone);
  },

  async getCustomers(businessId): Promise<Customer[]> {
    const rows = await fetchCustomerRows(businessId);
    return mapCustomers(rows, [], []);
  },

  async getAppointments(businessId, range, timezone) {
    const rows = await fetchAppointmentRows(businessId, range);
    const appointmentServices = await this.getAppointmentServices(businessId, rows.map((row) => row.id));
    return mapAppointments(rows, appointmentServices, timezone);
  },

  async getAppointmentServices(businessId, appointmentIds) {
    if (appointmentIds.length === 0) return [];
    const result = await supabase
      .from('appointment_services')
      .select('id,appointment_id,service_id,staff_member_id,position,duration_minutes,price')
      .eq('business_id', businessId)
      .in('appointment_id', appointmentIds)
      .order('position');
    return mapAppointmentServices(ensureData(result.data as AppointmentServiceRow[] | null, result.error, 'No hemos podido cargar los servicios de las citas.'));
  },

  async getAppointmentEvents(businessId, appointmentId, timezone) {
    const result = await supabase
      .from('appointment_events')
      .select('id,event_type,source,created_at')
      .eq('business_id', businessId)
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: false });
    return mapAppointmentEvents(ensureData(result.data as AppointmentEventRow[] | null, result.error, 'No hemos podido cargar el historial de la cita.'), timezone);
  },

  async getOperationalData(businessId, range) {
    const business = await this.getBusiness(businessId);
    const [staff, services, schedules, timeBlocks, customerRows, appointmentRows] = await Promise.all([
      this.getStaff(businessId),
      this.getServices(businessId),
      this.getSchedules(businessId),
      this.getTimeBlocks(businessId, range, business.timezone),
      fetchCustomerRows(businessId),
      fetchAppointmentRows(businessId, range),
    ]);
    const [staffServicesResult, appointmentServices] = await Promise.all([
      supabase.from('staff_services').select('id,staff_member_id,service_id,custom_duration_minutes,custom_price,active').eq('business_id', businessId).eq('active', true),
      this.getAppointmentServices(businessId, appointmentRows.map((row) => row.id)),
    ]);
    const staffServiceRows = ensureData(staffServicesResult.data as StaffServiceRow[] | null, staffServicesResult.error, 'No hemos podido cargar la asignación de servicios.');
    const appointments = mapAppointments(appointmentRows, appointmentServices, business.timezone);
    return {
      business,
      staff,
      services,
      staffServices: mapStaffServices(staffServiceRows, services),
      schedules,
      timeBlocks,
      customers: mapCustomers(customerRows, appointments, services),
      appointments,
      appointmentServices,
    };
  },
};
