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
  localDateTimeToIso,
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

function mutationError(error: { code?: string; message?: string } | null) {
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  if (code === '23505' || /customer phone already exists|duplicate.*phone/i.test(message)) {
    return new BeautyRepositoryError('Ya existe un cliente con ese teléfono.', 'conflict');
  }
  if (code === '42501' || /not authorized|not allowed|permission/i.test(message)) {
    return new BeautyRepositoryError('No tienes permisos para realizar esta acción.', 'permission');
  }
  if (/staff member has future appointments/i.test(message)) {
    return new BeautyRepositoryError('No puedes desactivar este profesional porque tiene citas futuras activas.', 'conflict');
  }
  if (/service is used in future appointments/i.test(message)) {
    return new BeautyRepositoryError('No puedes desactivar este servicio porque aparece en citas futuras activas.', 'conflict');
  }
  if (/schedule segments overlap/i.test(message)) {
    return new BeautyRepositoryError('Hay tramos del horario que se solapan.', 'conflict');
  }
  if (code === '23P01' || /not available|conflict/i.test(message)) {
    return new BeautyRepositoryError('Ese hueco ya no está disponible o existe un bloqueo.', 'conflict');
  }
  if (code === '22023' || /invalid|must|may only|fit in one schedule/i.test(message)) {
    if (/phone/i.test(message)) return new BeautyRepositoryError('Introduce un teléfono válido con prefijo internacional.', 'invalid');
    if (/email/i.test(message)) return new BeautyRepositoryError('Introduce un email válido.', 'invalid');
    if (/professional|staff/i.test(message)) return new BeautyRepositoryError('El profesional seleccionado no es válido.', 'invalid');
    if (/service.*not enabled/i.test(message)) return new BeautyRepositoryError('El profesional no está habilitado para uno de los servicios.', 'invalid');
    if (/schedule/i.test(message)) return new BeautyRepositoryError('La cita queda fuera del horario disponible.', 'invalid');
    return new BeautyRepositoryError('Los datos enviados no son válidos.', 'invalid');
  }
  if (code === 'P0002') return new BeautyRepositoryError('El registro solicitado ya no existe.', 'not_found');
  if (/jwt|session/i.test(message)) return new BeautyRepositoryError('Tu sesión ha caducado. Inicia sesión de nuevo.', 'session');
  if (/fetch|network/i.test(message)) return new BeautyRepositoryError('No hay conexión con el servicio. Inténtalo de nuevo.', 'network');
  return new BeautyRepositoryError('No hemos podido guardar los cambios.', 'unknown');
}

function ensureData<T>(data: T | null, error: { message: string } | null, message: string): T {
  if (error || data === null) throw new BeautyRepositoryError(message);
  return data;
}

async function fetchCustomerRows(businessId: string) {
  const result = await supabase
    .from('customers')
    .select('id,first_name,last_name,phone,phone_normalized,email,preferred_staff_member_id,notes,marketing_consent,reminder_consent,consent_updated_at,active')
    .eq('business_id', businessId)
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
      .select('id,display_name,phone,email,color_key,sort_order,active')
      .eq('business_id', businessId)
      .order('sort_order');
    return mapStaff(ensureData(result.data as StaffRow[] | null, result.error, 'No hemos podido cargar los profesionales.'));
  },

  async getServices(businessId) {
    const result = await supabase
      .from('beauty_services')
      .select('id,name,description,duration_minutes,buffer_before_minutes,buffer_after_minutes,price,currency,active,online_booking_enabled,reactivation_days')
      .eq('business_id', businessId)
      .order('name');
    return mapServices(ensureData(result.data as ServiceRow[] | null, result.error, 'No hemos podido cargar los servicios.'));
  },

  async getStaffServices(businessId) {
    const [rowsResult, services] = await Promise.all([
      supabase.from('staff_services').select('id,staff_member_id,service_id,custom_duration_minutes,custom_price,active').eq('business_id', businessId),
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

  async getCustomerHistory(businessId, customerId, timezone) {
    const appointmentsResult = await supabase
      .from('appointments')
      .select('id,customer_id,starts_at,ends_at,status,source,customer_notes,internal_notes,total_duration_minutes,total_price,currency,assigned_staff_member_id')
      .eq('business_id', businessId)
      .eq('customer_id', customerId)
      .order('starts_at', { ascending: false });
    const appointmentRows = ensureData(
      appointmentsResult.data as AppointmentRow[] | null,
      appointmentsResult.error,
      'No hemos podido cargar el historial completo del cliente.',
    );
    const appointmentServices = await this.getAppointmentServices(
      businessId,
      appointmentRows.map((row) => row.id),
    );
    return {
      appointments: mapAppointments(appointmentRows, appointmentServices, timezone),
      appointmentServices,
    };
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
      supabase.from('staff_services').select('id,staff_member_id,service_id,custom_duration_minutes,custom_price,active').eq('business_id', businessId),
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

  async updateAppointmentStatus(businessId, command) {
    const result = await supabase.rpc('update_beauty_appointment_status', {
      p_business_id: businessId,
      p_appointment_id: command.appointmentId,
      p_new_status: command.status,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido confirmar el nuevo estado.');
    return row.id;
  },

  async createTimeBlock(businessId, timezone, command) {
    const result = await supabase.rpc('create_beauty_time_block', {
      p_business_id: businessId,
      p_staff_member_id: command.staffId,
      p_starts_at: localDateTimeToIso(command.date, command.start, timezone),
      p_ends_at: localDateTimeToIso(command.date, command.end, timezone),
      p_block_type: command.type,
      p_reason: command.reason || null,
      p_notes: command.notes || null,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido confirmar el bloqueo.');
    return row.id;
  },

  async getAvailability(businessId, command) {
    const result = await supabase.rpc('get_multi_service_availability', {
      p_business_id: businessId,
      p_service_ids: command.serviceIds,
      p_date: command.date,
      p_staff_member_id: command.staffId,
      p_exclude_appointment_id: command.excludeAppointmentId ?? null,
      p_slot_interval_minutes: 15,
    });
    if (result.error) throw mutationError(result.error);
    const rows = (result.data ?? []) as Array<{ staff_member_id: string; starts_at: string; ends_at: string; service_duration_minutes: number; available: boolean }>;
    return rows.filter((row) => row.available).map((row) => ({
      staffId: row.staff_member_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      durationMinutes: row.service_duration_minutes,
    }));
  },

  async createAppointment(businessId, command) {
    const result = await supabase.rpc('create_appointment_with_services', {
      p_business_id: businessId,
      p_customer_id: command.customerId,
      p_starts_at: command.startsAt,
      p_assigned_staff_member_id: command.staffId,
      p_status: 'confirmed',
      p_source: 'manager',
      p_customer_notes: command.customerNotes || null,
      p_internal_notes: command.internalNotes || null,
      p_services: command.serviceIds.map((serviceId) => ({ service_id: serviceId })),
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido confirmar la cita.');
    return row.id;
  },

  async updateAppointment(businessId, command) {
    const result = await supabase.rpc('update_beauty_appointment', {
      p_business_id: businessId, p_appointment_id: command.appointmentId,
      p_starts_at: command.startsAt, p_assigned_staff_member_id: command.staffId,
      p_service_ids: command.serviceIds, p_internal_notes: command.internalNotes || null,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido actualizar la cita.');
    return row.id;
  },

  async cancelAppointment(businessId, command) {
    const result = await supabase.rpc('cancel_beauty_appointment', {
      p_business_id: businessId, p_appointment_id: command.appointmentId, p_reason: command.reason || null,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido cancelar la cita.');
    return row.id;
  },

  async updateTimeBlock(businessId, timezone, command) {
    const result = await supabase.rpc('update_beauty_time_block', {
      p_business_id: businessId, p_block_id: command.blockId, p_staff_member_id: command.staffId,
      p_starts_at: localDateTimeToIso(command.date, command.start, timezone),
      p_ends_at: localDateTimeToIso(command.date, command.end, timezone),
      p_block_type: command.type, p_reason: command.reason || null, p_notes: command.notes || null,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido actualizar el bloqueo.');
    return row.id;
  },

  async deactivateTimeBlock(businessId, command) {
    const result = await supabase.rpc('deactivate_beauty_time_block', { p_business_id: businessId, p_block_id: command.blockId });
    if (result.error) throw mutationError(result.error);
    return String(result.data);
  },

  async createCustomer(businessId, command) {
    const result = await supabase.rpc('create_beauty_customer', {
      p_business_id: businessId,
      p_first_name: command.firstName,
      p_last_name: command.lastName || null,
      p_phone: command.phone,
      p_email: command.email || null,
      p_preferred_staff_member_id: command.preferredStaffId,
      p_notes: command.notes || null,
      p_reminder_consent: command.reminderConsent,
      p_marketing_consent: command.marketingConsent,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido crear el cliente.');
    return row.id;
  },

  async updateCustomer(businessId, command) {
    const result = await supabase.rpc('update_beauty_customer', {
      p_business_id: businessId,
      p_customer_id: command.customerId,
      p_first_name: command.firstName,
      p_last_name: command.lastName || null,
      p_phone: command.phone,
      p_email: command.email || null,
      p_preferred_staff_member_id: command.preferredStaffId,
      p_notes: command.notes || null,
      p_reminder_consent: command.reminderConsent,
      p_marketing_consent: command.marketingConsent,
      p_active: command.active,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido actualizar el cliente.');
    return row.id;
  },

  async deactivateCustomer(businessId, command) {
    const result = await supabase.rpc('deactivate_beauty_customer', {
      p_business_id: businessId,
      p_customer_id: command.customerId,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido desactivar el cliente.');
    return row.id;
  },

  async createStaff(businessId, command) {
    const result = await supabase.rpc('create_beauty_staff_member', {
      p_business_id: businessId, p_display_name: command.name, p_phone: command.phone || null,
      p_email: command.email || null, p_color_key: command.colorKey, p_sort_order: command.sortOrder,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido crear el profesional.');
    return row.id;
  },

  async updateStaff(businessId, command) {
    const result = await supabase.rpc('update_beauty_staff_member', {
      p_business_id: businessId, p_staff_member_id: command.staffId, p_display_name: command.name,
      p_phone: command.phone || null, p_email: command.email || null, p_color_key: command.colorKey,
      p_sort_order: command.sortOrder, p_active: command.active,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido actualizar el profesional.');
    return row.id;
  },

  async deactivateStaff(businessId, command) {
    const result = await supabase.rpc('deactivate_beauty_staff_member', { p_business_id: businessId, p_staff_member_id: command.staffId });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido desactivar el profesional.');
    return row.id;
  },

  async createService(businessId, command) {
    const result = await supabase.rpc('create_beauty_service', {
      p_business_id: businessId, p_name: command.name, p_description: command.description || null,
      p_duration_minutes: command.durationMinutes, p_buffer_before_minutes: command.bufferBeforeMinutes,
      p_buffer_after_minutes: command.bufferAfterMinutes, p_price: command.price, p_currency: command.currency,
      p_online_booking_enabled: command.onlineBookingEnabled, p_reactivation_days: command.reactivationDays,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido crear el servicio.');
    return row.id;
  },

  async updateService(businessId, command) {
    const result = await supabase.rpc('update_beauty_service', {
      p_business_id: businessId, p_service_id: command.serviceId, p_name: command.name,
      p_description: command.description || null, p_duration_minutes: command.durationMinutes,
      p_buffer_before_minutes: command.bufferBeforeMinutes, p_buffer_after_minutes: command.bufferAfterMinutes,
      p_price: command.price, p_currency: command.currency, p_online_booking_enabled: command.onlineBookingEnabled,
      p_reactivation_days: command.reactivationDays, p_active: command.active,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido actualizar el servicio.');
    return row.id;
  },

  async deactivateService(businessId, command) {
    const result = await supabase.rpc('deactivate_beauty_service', { p_business_id: businessId, p_service_id: command.serviceId });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido desactivar el servicio.');
    return row.id;
  },

  async setStaffService(businessId, command) {
    const result = await supabase.rpc('set_beauty_staff_service', {
      p_business_id: businessId, p_staff_member_id: command.staffId, p_service_id: command.serviceId,
      p_custom_duration_minutes: command.durationMinutes, p_custom_price: command.price, p_active: command.active,
    });
    if (result.error) throw mutationError(result.error);
    const row = result.data as { id?: string } | null;
    if (!row?.id) throw new BeautyRepositoryError('No hemos podido guardar la asignación.');
    return row.id;
  },

  async replaceWeeklySchedule(businessId, command) {
    const result = await supabase.rpc('replace_beauty_staff_weekly_schedule', {
      p_business_id: businessId, p_staff_member_id: command.staffId, p_segments: command.segments.map((segment) => ({
        day_of_week: segment.dayOfWeek, start_time: segment.start, end_time: segment.end,
      })),
    });
    if (result.error) throw mutationError(result.error);
  },
};
