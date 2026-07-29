import {
  appointments,
  business,
  customers,
  services,
  staff,
  timeBlocks,
} from '../mock/data';
import type { BeautyRepository } from './BeautyRepository';
import { BeautyRepositoryError } from './BeautyRepository';
import { localDateTimeToIso } from './mappers';
import type { BeautyOperationalData, DateRange, WritableAppointmentStatus } from './types';

let mockAppointments = appointments.map((appointment) => ({ ...appointment }));
let mockTimeBlocks = timeBlocks.map((block) => ({ ...block }));

function inRange(date: string, range: DateRange) {
  return date >= range.from && date < range.to;
}

export const mockBeautyRepository: BeautyRepository = {
  async getBusiness() {
    return { id: business.id, name: business.name, slug: 'luna-beauty-studio', timezone: 'Europe/Madrid', currency: 'EUR', language: 'es' };
  },
  async getStaff() {
    return staff;
  },
  async getServices() {
    return services;
  },
  async getStaffServices() {
    return staff.flatMap((member) => services.map((service) => ({
      id: `${member.id}-${service.id}`,
      staffId: member.id,
      serviceId: service.id,
      durationMinutes: service.durationMinutes,
      price: service.price,
      active: true,
    })));
  },
  async getSchedules() {
    return [];
  },
  async getTimeBlocks(_businessId, range) {
    return mockTimeBlocks.filter((block) => inRange(block.date, range));
  },
  async getCustomers() {
    return customers;
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
        durationMinutes: services.find((service) => service.id === serviceId)?.durationMinutes ?? 30,
        price: services.find((service) => service.id === serviceId)?.price ?? 0,
      })));
  },
  async getAppointmentEvents(_businessId, appointmentId) {
    return mockAppointments.find((appointment) => appointment.id === appointmentId)?.history ?? [];
  },
  async getOperationalData(businessId, range): Promise<BeautyOperationalData> {
    const visibleAppointments = mockAppointments.filter((appointment) => inRange(appointment.date, range)).map((appointment) => ({ ...appointment, historyLoaded: true }));
    return {
      business: await this.getBusiness(businessId),
      staff,
      services,
      staffServices: await this.getStaffServices(businessId),
      schedules: [],
      timeBlocks: mockTimeBlocks.filter((block) => inRange(block.date, range)),
      customers,
      appointments: visibleAppointments,
      appointmentServices: await this.getAppointmentServices(businessId, visibleAppointments.map((appointment) => appointment.id)),
    };
  },
  async updateAppointmentStatus(_businessId, command) {
    const appointment = mockAppointments.find((item) => item.id === command.appointmentId);
    if (!appointment) throw new BeautyRepositoryError('No se encuentra la cita.', 'not_found');
    const allowed: Partial<Record<typeof appointment.status, WritableAppointmentStatus[]>> = {
      pending: ['confirmed'],
      confirmed: ['arrived', 'no_show'],
      arrived: ['in_service'],
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
    mockTimeBlocks.push({ id, date: command.date, start: command.start, end: command.end, staffId: command.staffId ?? 'all', reason: command.reason || 'Bloqueo' });
    return id;
  },
  async getAvailability(_businessId, command) {
    const slots = ['09:00', '10:00', '11:00', '12:00', '16:00', '17:00'];
    const service = services.find((item) => item.id === command.serviceId);
    return slots.map((time) => {
      const startsAt = localDateTimeToIso(command.date, time, 'Europe/Madrid');
      return {
        staffId: command.staffId,
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + (service?.durationMinutes ?? 30) * 60000).toISOString(),
        durationMinutes: service?.durationMinutes ?? 30,
      };
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
};
