import {
  appointments,
  business,
  customers,
  services,
  staff,
  timeBlocks,
} from '../mock/data';
import type { BeautyRepository } from './BeautyRepository';
import type { BeautyOperationalData, DateRange } from './types';

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
    return timeBlocks.filter((block) => inRange(block.date, range));
  },
  async getCustomers() {
    return customers;
  },
  async getAppointments(_businessId, range) {
    return appointments.filter((appointment) => inRange(appointment.date, range)).map((appointment) => ({ ...appointment, historyLoaded: true }));
  },
  async getAppointmentServices(_businessId, appointmentIds) {
    return appointments
      .filter((appointment) => appointmentIds.includes(appointment.id))
      .map((appointment) => ({
        id: `mock-${appointment.id}`,
        appointmentId: appointment.id,
        serviceId: appointment.serviceId,
        staffId: appointment.staffId,
        position: 1,
        durationMinutes: services.find((service) => service.id === appointment.serviceId)?.durationMinutes ?? 30,
        price: services.find((service) => service.id === appointment.serviceId)?.price ?? 0,
      }));
  },
  async getAppointmentEvents(_businessId, appointmentId) {
    return appointments.find((appointment) => appointment.id === appointmentId)?.history ?? [];
  },
  async getOperationalData(businessId, range): Promise<BeautyOperationalData> {
    const visibleAppointments = appointments.filter((appointment) => inRange(appointment.date, range)).map((appointment) => ({ ...appointment, historyLoaded: true }));
    return {
      business: await this.getBusiness(businessId),
      staff,
      services,
      staffServices: await this.getStaffServices(businessId),
      schedules: [],
      timeBlocks: timeBlocks.filter((block) => inRange(block.date, range)),
      customers,
      appointments: visibleAppointments,
      appointmentServices: await this.getAppointmentServices(businessId, visibleAppointments.map((appointment) => appointment.id)),
    };
  },
};
