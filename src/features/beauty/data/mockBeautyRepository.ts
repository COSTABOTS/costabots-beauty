import {
  appointments,
  business,
  customers as seededCustomers,
  services,
  staff,
  timeBlocks,
} from '../mock/data';
import type { BeautyRepository } from './BeautyRepository';
import { BeautyRepositoryError } from './BeautyRepository';
import { localDateTimeToIso } from './mappers';
import type { BeautyOperationalData, DateRange, WritableAppointmentStatus } from './types';
import type { BeautyService } from '../types';

let mockAppointments = appointments.map((appointment) => ({ ...appointment }));
let mockTimeBlocks = timeBlocks.map((block) => ({ ...block }));
let mockStaff = staff.map((member, index) => ({ ...member, active: true, sortOrder: index, phone: '', email: '' }));
let mockServices: BeautyService[] = services.map((service) => ({ ...service, active: true, description: '', bufferBeforeMinutes: 0, bufferAfterMinutes: 0, currency: 'EUR', onlineBookingEnabled: true, reactivationDays: null }));
let mockStaffServices = mockStaff.flatMap((member) => mockServices.map((service) => ({
  id: `${member.id}-${service.id}`, staffId: member.id, serviceId: service.id,
  durationMinutes: service.durationMinutes, price: service.price, active: true,
})));
let mockSchedules: import('./types').StaffSchedule[] = [];
let mockCustomers = seededCustomers.map((customer) => ({
  ...customer,
  firstName: customer.name.split(' ')[0] ?? customer.name,
  lastName: customer.name.split(' ').slice(1).join(' '),
  email: '',
  marketingConsent: customer.messagingConsent,
  reminderConsent: customer.messagingConsent,
  active: true,
}));
let mockBusiness = {
  id: business.id,
  name: business.name,
  slug: 'luna-beauty-studio',
  timezone: 'Europe/Madrid',
  currency: 'EUR',
  language: 'es',
  phone: '+34 600 000 000',
  email: 'hola@lunabeauty.example',
  address: 'Calle de ejemplo, 12',
};

function inRange(date: string, range: DateRange) {
  return date >= range.from && date < range.to;
}

export const mockBeautyRepository: BeautyRepository = {
  async getBusiness() {
    return { ...mockBusiness };
  },
  async updateBusinessProfile(_businessId, command) {
    mockBusiness = {
      ...mockBusiness,
      name: command.name.trim(),
      phone: command.phone.trim(),
      email: command.email.trim(),
      address: command.address.trim(),
      timezone: command.timezone,
      currency: command.currency.toUpperCase(),
    };
    return mockBusiness.id;
  },
  async getStaff() {
    return mockStaff.map((member) => ({ ...member }));
  },
  async getServices() {
    return mockServices.map((service) => ({ ...service }));
  },
  async getStaffServices() {
    return mockStaffServices.map((item) => ({ ...item }));
  },
  async getSchedules() {
    return mockSchedules.map((item) => ({ ...item }));
  },
  async getTimeBlocks(_businessId, range) {
    return mockTimeBlocks.filter((block) => inRange(block.date, range));
  },
  async getCustomers() {
    return mockCustomers.map((customer) => ({ ...customer }));
  },
  async getCustomerHistory(_businessId, customerId) {
    const customerAppointments = mockAppointments
      .filter((appointment) => appointment.customerId === customerId)
      .map((appointment) => ({ ...appointment, historyLoaded: true }))
      .sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`));
    return {
      appointments: customerAppointments,
      appointmentServices: await this.getAppointmentServices(
        _businessId,
        customerAppointments.map((appointment) => appointment.id),
      ),
    };
  },
  async getAppointments(_businessId, range) {
    return mockAppointments.filter((appointment) => inRange(appointment.date, range)).map((appointment) => ({ ...appointment, historyLoaded: true }));
  },
  async getAppointmentServices(_businessId, appointmentIds) {
    return mockAppointments
      .filter((appointment) => appointmentIds.includes(appointment.id))
      .flatMap((appointment) => (appointment.serviceIds?.length ? appointment.serviceIds : [appointment.serviceId]).map((serviceId, index) => ({
        id: `mock-${appointment.id}-${serviceId}`,
        appointmentId: appointment.id,
        serviceId,
        staffId: appointment.staffId,
        position: index + 1,
        durationMinutes: mockServices.find((service) => service.id === serviceId)?.durationMinutes ?? 30,
        price: mockServices.find((service) => service.id === serviceId)?.price ?? 0,
      })));
  },
  async getAppointmentEvents(_businessId, appointmentId) {
    return mockAppointments.find((appointment) => appointment.id === appointmentId)?.history ?? [];
  },
  async getOperationalData(businessId, range): Promise<BeautyOperationalData> {
    const visibleAppointments = mockAppointments.filter((appointment) => inRange(appointment.date, range)).map((appointment) => ({ ...appointment, historyLoaded: true }));
    return {
      business: await this.getBusiness(businessId),
      staff: await this.getStaff(businessId),
      services: await this.getServices(businessId),
      staffServices: await this.getStaffServices(businessId),
      schedules: await this.getSchedules(businessId),
      timeBlocks: mockTimeBlocks.filter((block) => inRange(block.date, range)),
      customers: mockCustomers.map((customer) => ({ ...customer })),
      appointments: visibleAppointments,
      appointmentServices: await this.getAppointmentServices(businessId, visibleAppointments.map((appointment) => appointment.id)),
    };
  },
  async getAgendaRange(businessId, range) {
    const appointments = await this.getAppointments(businessId, range, 'Europe/Madrid');
    return {
      appointments,
      appointmentServices: await this.getAppointmentServices(businessId, appointments.map((appointment) => appointment.id)),
      timeBlocks: await this.getTimeBlocks(businessId, range, 'Europe/Madrid'),
    };
  },
  async updateAppointmentStatus(_businessId, command) {
    const appointment = mockAppointments.find((item) => item.id === command.appointmentId);
    if (!appointment) throw new BeautyRepositoryError('No se encuentra la cita.', 'not_found');
    const allowed: Partial<Record<typeof appointment.status, WritableAppointmentStatus[]>> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['completed', 'no_show', 'cancelled'],
      arrived: ['completed'],
      in_service: ['completed'],
    };
    if (!allowed[appointment.status]?.includes(command.status)) {
      throw new BeautyRepositoryError('Ese cambio de estado no está permitido.', 'invalid');
    }
    appointment.status = command.status;
    appointment.history = [{ id: `mock-event-${Date.now()}`, label: `Estado cambiado a ${command.status}`, at: 'Ahora' }, ...appointment.history];
    return appointment.id;
  },
  async createTimeBlock(_businessId, _timezone, command) {
    if (command.start >= command.end) throw new BeautyRepositoryError('La hora de inicio debe ser anterior a la hora de fin.', 'invalid');
    const id = `mock-block-${Date.now()}`;
    mockTimeBlocks.push({ id, date: command.date, start: command.start, end: command.end, staffId: command.staffId ?? 'all', reason: command.reason || 'Bloqueo', type: command.type });
    return id;
  },
  async getAvailability(_businessId, command) {
    const slots = ['09:00', '10:00', '11:00', '12:00', '16:00', '17:00'];
    if (new Set(command.serviceIds).size !== command.serviceIds.length) throw new BeautyRepositoryError('No puedes repetir un servicio.', 'invalid');
    const assignments = command.serviceIds.map((id) => mockStaffServices.find((item) => item.staffId === command.staffId && item.serviceId === id && item.active));
    if (assignments.some((item) => !item)) throw new BeautyRepositoryError('El profesional no realiza uno de los servicios seleccionados.', 'invalid');
    const selected = command.serviceIds.map((id) => mockServices.find((item) => item.id === id && item.active)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (selected.length !== command.serviceIds.length) throw new BeautyRepositoryError('Uno de los servicios no está disponible.', 'invalid');
    const duration = assignments.reduce((total, item) => total + (item?.durationMinutes ?? 0), 0);
    const bufferBefore = selected[0]?.bufferBeforeMinutes ?? 0;
    const bufferAfter = selected[selected.length - 1]?.bufferAfterMinutes ?? 0;
    return slots.map((time) => {
      const startsAt = localDateTimeToIso(command.date, time, 'Europe/Madrid');
      return {
        staffId: command.staffId,
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + duration * 60000).toISOString(),
        durationMinutes: duration,
      };
    }).filter((slot) => {
      const occupiedStart = new Date(slot.startsAt).getTime() - bufferBefore * 60000;
      const occupiedEnd = new Date(slot.endsAt).getTime() + bufferAfter * 60000;
      const appointmentConflict = mockAppointments.some((appointment) => appointment.id !== command.excludeAppointmentId && appointment.staffId === command.staffId && appointment.status !== 'cancelled' && appointment.date === command.date
        && new Date(localDateTimeToIso(appointment.date, appointment.start, 'Europe/Madrid')).getTime() < occupiedEnd
        && new Date(localDateTimeToIso(appointment.date, appointment.end, 'Europe/Madrid')).getTime() > occupiedStart);
      const blockConflict = mockTimeBlocks.some((block) => block.date === command.date && (block.staffId === 'all' || block.staffId === command.staffId)
        && new Date(localDateTimeToIso(block.date, block.start, 'Europe/Madrid')).getTime() < occupiedEnd
        && new Date(localDateTimeToIso(block.date, block.end, 'Europe/Madrid')).getTime() > occupiedStart);
      return !appointmentConflict && !blockConflict;
    });
  },
  async createAppointment(_businessId, command) {
    const selectedServices = command.serviceIds.map((id) => services.find((service) => service.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!selectedServices.length) throw new BeautyRepositoryError('Selecciona al menos un servicio.', 'invalid');
    const startDate = new Date(command.startsAt);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(startDate);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
    const duration = selectedServices.reduce((total, service) => total + service.durationMinutes, 0);
    const endParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(startDate.getTime() + duration * 60000));
    const id = `mock-appointment-${Date.now()}`;
    mockAppointments.push({
      id,
      date: `${part('year')}-${part('month')}-${part('day')}`,
      start: `${part('hour')}:${part('minute')}`,
      end: endParts,
      customerId: command.customerId,
      serviceId: command.serviceIds[0],
      serviceIds: command.serviceIds,
      staffId: command.staffId,
      status: 'confirmed',
      notes: command.customerNotes,
      source: 'Manual',
      history: [{ id: `mock-event-${Date.now()}`, label: 'Cita creada', at: 'Ahora' }],
      historyLoaded: true,
      totalDurationMinutes: duration,
      totalPrice: selectedServices.reduce((total, service) => total + service.price, 0),
      currency: 'EUR',
    });
    return id;
  },
  async updateAppointment(_businessId, command) {
    const appointment = mockAppointments.find((item) => item.id === command.appointmentId);
    if (!appointment || !['pending','confirmed'].includes(appointment.status)) throw new BeautyRepositoryError('La cita no se puede editar.', 'invalid');
    const selected = command.serviceIds.map((id) => mockServices.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const duration = selected.reduce((total,item)=>total+item.durationMinutes,0);
    const start = new Date(command.startsAt);
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(start);
    const part=(type:Intl.DateTimeFormatPartTypes)=>parts.find((item)=>item.type===type)?.value??'';
    Object.assign(appointment,{date:`${part('year')}-${part('month')}-${part('day')}`,start:`${part('hour')}:${part('minute')}`,end:new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(start.getTime()+duration*60000)),staffId:command.staffId,serviceId:command.serviceIds[0],serviceIds:command.serviceIds,notes:command.internalNotes,totalDurationMinutes:duration,totalPrice:selected.reduce((t,s)=>t+s.price,0)});
    appointment.history=[{id:`mock-event-${Date.now()}`,label:'Cita actualizada',at:'Ahora'},...appointment.history];
    return appointment.id;
  },
  async cancelAppointment(_businessId, command) {
    const appointment=mockAppointments.find((item)=>item.id===command.appointmentId);
    if(!appointment||!['pending','confirmed'].includes(appointment.status)) throw new BeautyRepositoryError('La cita no se puede cancelar.','invalid');
    appointment.status='cancelled'; appointment.history=[{id:`mock-event-${Date.now()}`,label:`Cita cancelada${command.reason?`: ${command.reason}`:''}`,at:'Ahora'},...appointment.history]; return appointment.id;
  },
  async updateTimeBlock(_businessId,_timezone,command) {
    const block=mockTimeBlocks.find((item)=>item.id===command.blockId); if(!block) throw new BeautyRepositoryError('No se encuentra el bloqueo.','not_found');
    Object.assign(block,{date:command.date,start:command.start,end:command.end,staffId:command.staffId??'all',reason:command.reason||'Bloqueo',type:command.type}); return block.id;
  },
  async deactivateTimeBlock(_businessId,command) {
    const index=mockTimeBlocks.findIndex((item)=>item.id===command.blockId); if(index<0) throw new BeautyRepositoryError('No se encuentra el bloqueo.','not_found'); mockTimeBlocks.splice(index,1); return command.blockId;
  },
  async createCustomer(_businessId, command) {
    const digits = command.phone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) throw new BeautyRepositoryError('Introduce un teléfono válido.', 'invalid');
    const normalized = command.phone.trim().startsWith('+')
      ? `+${digits}`
      : digits.length === 9 ? `+34${digits}` : `+${digits.replace(/^00/, '')}`;
    if (mockCustomers.some((customer) => customer.phone.replace(/\D/g, '') === normalized.replace(/\D/g, ''))) {
      throw new BeautyRepositoryError('Ya existe un cliente con ese teléfono.', 'conflict');
    }
    const id = `mock-customer-${Date.now()}`;
    mockCustomers.push({
      id,
      name: [command.firstName.trim(), command.lastName.trim()].filter(Boolean).join(' '),
      firstName: command.firstName.trim(),
      lastName: command.lastName.trim(),
      phone: normalized,
      maskedPhone: normalized,
      email: command.email.trim(),
      lastVisit: 'Sin visitas',
      recommendedService: 'Sin sugerencia',
      recurrent: false,
      preferredStaffId: command.preferredStaffId ?? undefined,
      notes: command.notes.trim(),
      messagingConsent: command.marketingConsent || command.reminderConsent,
      marketingConsent: command.marketingConsent,
      reminderConsent: command.reminderConsent,
      active: true,
      nextReactivation: 'Pendiente de configurar',
      usualServices: ['Sin historial'],
      appointmentCount: 0,
    });
    return id;
  },
  async updateCustomer(_businessId, command) {
    const index = mockCustomers.findIndex((customer) => customer.id === command.customerId);
    if (index < 0) throw new BeautyRepositoryError('El cliente ya no existe.', 'not_found');
    const digits = command.phone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) throw new BeautyRepositoryError('Introduce un teléfono válido.', 'invalid');
    const normalized = command.phone.trim().startsWith('+')
      ? `+${digits}`
      : digits.length === 9 ? `+34${digits}` : `+${digits.replace(/^00/, '')}`;
    if (mockCustomers.some((customer) => customer.id !== command.customerId && customer.phone.replace(/\D/g, '') === normalized.replace(/\D/g, ''))) {
      throw new BeautyRepositoryError('Ya existe un cliente con ese teléfono.', 'conflict');
    }
    const current = mockCustomers[index];
    mockCustomers[index] = {
      ...current,
      name: [command.firstName.trim(), command.lastName.trim()].filter(Boolean).join(' '),
      firstName: command.firstName.trim(),
      lastName: command.lastName.trim(),
      phone: normalized,
      maskedPhone: normalized,
      email: command.email.trim(),
      preferredStaffId: command.preferredStaffId ?? undefined,
      notes: command.notes.trim(),
      messagingConsent: command.marketingConsent || command.reminderConsent,
      marketingConsent: command.marketingConsent,
      reminderConsent: command.reminderConsent,
      active: command.active,
    };
    return command.customerId;
  },
  async deactivateCustomer(_businessId, command) {
    const customer = mockCustomers.find((item) => item.id === command.customerId);
    if (!customer) throw new BeautyRepositoryError('El cliente ya no existe.', 'not_found');
    customer.active = false;
    return customer.id;
  },
  async createStaff(_businessId, command) {
    if (!command.name.trim()) throw new BeautyRepositoryError('El nombre es obligatorio.', 'invalid');
    const id = `mock-staff-${Date.now()}`;
    mockStaff.push({ id, name: command.name.trim(), role: 'Profesional', initials: command.name.trim().split(' ').map((part) => part[0]).join('').slice(0, 2), accent: command.colorKey, phone: command.phone, email: command.email, sortOrder: command.sortOrder, active: true });
    return id;
  },
  async updateStaff(_businessId, command) {
    const item = mockStaff.find((member) => member.id === command.staffId);
    if (!item) throw new BeautyRepositoryError('No se encuentra el profesional.', 'not_found');
    Object.assign(item, { name: command.name.trim(), initials: command.name.trim().split(' ').map((part) => part[0]).join('').slice(0, 2), accent: command.colorKey, phone: command.phone, email: command.email, sortOrder: command.sortOrder, active: command.active });
    return item.id;
  },
  async deactivateStaff(_businessId, command) {
    const item = mockStaff.find((member) => member.id === command.staffId);
    if (!item) throw new BeautyRepositoryError('No se encuentra el profesional.', 'not_found');
    item.active = false;
    return item.id;
  },
  async createService(_businessId, command) {
    if (command.durationMinutes <= 0 || command.price < 0) throw new BeautyRepositoryError('La duración o el precio no son válidos.', 'invalid');
    const id = `mock-service-${Date.now()}`;
    mockServices.push({ id, name: command.name.trim(), description: command.description, durationMinutes: command.durationMinutes, bufferBeforeMinutes: command.bufferBeforeMinutes, bufferAfterMinutes: command.bufferAfterMinutes, price: command.price, currency: command.currency, onlineBookingEnabled: command.onlineBookingEnabled, reactivationDays: command.reactivationDays, active: true, category: 'hair' });
    return id;
  },
  async updateService(_businessId, command) {
    const item = mockServices.find((service) => service.id === command.serviceId);
    if (!item) throw new BeautyRepositoryError('No se encuentra el servicio.', 'not_found');
    Object.assign(item, command, { id: item.id });
    return item.id;
  },
  async deactivateService(_businessId, command) {
    const item = mockServices.find((service) => service.id === command.serviceId);
    if (!item) throw new BeautyRepositoryError('No se encuentra el servicio.', 'not_found');
    item.active = false;
    return item.id;
  },
  async setStaffService(_businessId, command) {
    const existing = mockStaffServices.find((item) => item.staffId === command.staffId && item.serviceId === command.serviceId);
    const service = mockServices.find((item) => item.id === command.serviceId);
    if (!service) throw new BeautyRepositoryError('No se encuentra el servicio.', 'not_found');
    if (existing) Object.assign(existing, { durationMinutes: command.durationMinutes ?? service.durationMinutes, price: command.price ?? service.price, active: command.active });
    else mockStaffServices.push({ id: `mock-assignment-${Date.now()}`, staffId: command.staffId, serviceId: command.serviceId, durationMinutes: command.durationMinutes ?? service.durationMinutes, price: command.price ?? service.price, active: command.active });
    return existing?.id ?? mockStaffServices[mockStaffServices.length - 1].id;
  },
  async replaceWeeklySchedule(_businessId, command) {
    for (const segment of command.segments) {
      if (segment.start >= segment.end) throw new BeautyRepositoryError('La hora de inicio debe ser anterior a la hora final.', 'invalid');
      if (command.segments.some((other) => other !== segment && other.dayOfWeek === segment.dayOfWeek && segment.start < other.end && segment.end > other.start)) {
        throw new BeautyRepositoryError('Hay tramos de horario solapados.', 'conflict');
      }
    }
    mockSchedules = [
      ...mockSchedules.filter((item) => item.staffId !== command.staffId),
      ...command.segments.map((segment, index) => ({ id: `mock-schedule-${Date.now()}-${index}`, staffId: command.staffId, dayOfWeek: segment.dayOfWeek, start: segment.start, end: segment.end, active: true })),
    ];
  },
};
