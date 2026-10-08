import type {
  Appointment,
  AutomationRule,
  BeautyBusiness,
  BeautyService,
  Conversation,
  Customer,
  StaffMember,
  TimeBlock,
} from '../types';
import { addCalendarDays, dateInTimeZone } from '../data/dateRange.ts';
import { serviceTemplates } from '../data/serviceTemplates.ts';

const timezone = 'Europe/Madrid';

function maskPhone(phone: string) {
  return `${phone.slice(0, 7)} *** ${phone.slice(-3)}`;
}

function appointment(
  id: string,
  date: string,
  start: string,
  end: string,
  customerId: string,
  serviceId: string,
  staffId: string,
  status: Appointment['status'] = 'confirmed',
  source: Appointment['source'] = 'WhatsApp IA',
): Appointment {
  return {
    id,
    date,
    start,
    end,
    customerId,
    serviceId,
    staffId,
    status,
    source,
    history: [{ id: `history-${id}`, label: status === 'completed' ? 'Servicio finalizado' : 'Cita confirmada', at: status === 'completed' ? 'Visita anterior' : 'Reserva registrada' }],
  };
}

export function createBarberDemoSeed(referenceInstant = new Date()) {
  const today = dateInTimeZone(timezone, referenceInstant);
  const yesterday = addCalendarDays(today, -1);
  const tomorrow = addCalendarDays(today, 1);
  const dayAfterTomorrow = addCalendarDays(today, 2);
  const laterThisWeek = addCalendarDays(today, 4);

  const business: BeautyBusiness = {
    id: 'barber-demo',
    name: 'NØR Barber Club',
    ownerName: 'Alex',
    assistantActive: true,
    businessType: 'barber_shop',
  };

  const staff: StaffMember[] = [
    { id: 'alex', name: 'Alex', role: 'Propietario / Barbero', initials: 'AL', accent: 'sand' },
    { id: 'dani', name: 'Dani', role: 'Barbero', initials: 'DA', accent: 'sage' },
    { id: 'mario', name: 'Mario', role: 'Barbero', initials: 'MA', accent: 'coral' },
  ];

  const services: BeautyService[] = serviceTemplates.barber_shop.map((service) => ({
    id: service.id,
    name: service.name,
    durationMinutes: service.durationMinutes,
    price: service.price,
    category: 'barber',
  }));

  const customerRows = [
    ['c1', 'Marcos Ruiz', '+34 600 100 101', 'Corte', 'alex', 'Prefiere degradado bajo.'],
    ['c2', 'Daniel Moreno', '+34 600 100 102', 'Corte + barba', 'dani', 'Cliente mensual.'],
    ['c3', 'Sergio López', '+34 600 100 103', 'Barba', 'mario', 'Barba corta y perfilada.'],
    ['c4', 'Álvaro Martín', '+34 600 100 104', 'Corte', 'alex', 'Laterales a máquina.'],
    ['c5', 'Pablo García', '+34 600 100 105', 'Corte + barba', 'dani', 'Prefiere cita de tarde.'],
    ['c6', 'Javier Torres', '+34 600 100 106', 'Afeitado clásico', 'mario', 'Piel sensible.'],
    ['c7', 'Hugo Navarro', '+34 600 100 107', 'Corte infantil', 'alex', 'Cita acompañada.'],
    ['c8', 'Iván Romero', '+34 600 100 108', 'Arreglo de barba premium', 'dani', 'Usar acabado natural.'],
    ['c9', 'Adrián Vega', '+34 600 100 109', 'Corte', 'mario', 'Primera visita por WhatsApp.'],
    ['c10', 'Raúl Santos', '+34 600 100 110', 'Corte + barba', 'alex', 'Cliente recurrente.'],
  ] as const;

  const customers: Customer[] = customerRows.map(([id, name, phone, recommendedService, preferredStaffId, notes], index) => ({
    id,
    name,
    phone,
    maskedPhone: maskPhone(phone),
    lastVisit: index < 7 ? 'Visita reciente' : 'Sin visitas',
    recommendedService,
    nextAppointmentId: index < 6 ? `today-${index + 1}` : undefined,
    recurrent: index < 8,
    preferredStaffId,
    notes,
    messagingConsent: true,
    nextReactivation: 'En 4 semanas',
    usualServices: [recommendedService],
  }));

  const appointments: Appointment[] = [
    appointment('today-1', today, '10:00', '10:30', 'c1', 'barber-cut', 'alex'),
    appointment('today-2', today, '11:00', '11:45', 'c2', 'barber-cut-beard', 'dani'),
    appointment('today-3', today, '12:30', '13:00', 'c3', 'barber-beard', 'mario', 'pending'),
    appointment('today-4', today, '16:00', '16:30', 'c4', 'barber-cut', 'alex'),
    appointment('today-5', today, '17:30', '18:15', 'c5', 'barber-cut-beard', 'dani'),
    appointment('today-6', today, '19:00', '19:30', 'c6', 'barber-classic-shave', 'mario'),
    appointment('tomorrow-1', tomorrow, '09:30', '10:00', 'c7', 'barber-child-cut', 'alex'),
    appointment('tomorrow-2', tomorrow, '11:30', '12:00', 'c8', 'barber-premium-beard', 'dani'),
    appointment('tomorrow-3', tomorrow, '16:30', '17:15', 'c9', 'barber-cut-beard', 'mario'),
    appointment('tomorrow-4', tomorrow, '18:00', '18:45', 'c10', 'barber-cut-beard', 'alex'),
    appointment('week-1', dayAfterTomorrow, '10:30', '11:00', 'c3', 'barber-beard', 'mario'),
    appointment('week-2', dayAfterTomorrow, '17:00', '17:30', 'c1', 'barber-cut', 'alex'),
    appointment('week-3', laterThisWeek, '12:00', '12:45', 'c5', 'barber-cut-beard', 'dani'),
    appointment('week-4', laterThisWeek, '18:30', '19:00', 'c8', 'barber-premium-beard', 'mario'),
    appointment('past-1', yesterday, '10:00', '10:30', 'c10', 'barber-cut', 'alex', 'completed', 'Manual'),
    appointment('past-2', yesterday, '11:00', '11:45', 'c2', 'barber-cut-beard', 'dani', 'completed'),
    appointment('past-3', yesterday, '17:00', '17:30', 'c6', 'barber-classic-shave', 'mario', 'completed'),
  ];

  const conversations: Conversation[] = [
    {
      id: 'conversation-booking', customerId: 'c9', lastMessage: 'Perfecto, muchas gracias.', time: '10:18', status: 'ai_handled', unread: 0,
      messages: [
        { id: 'booking-1', sender: 'customer', text: 'Hola, ¿tenéis hueco mañana por la tarde para corte y barba?', time: '10:16' },
        { id: 'booking-2', sender: 'ai', text: 'Sí, mañana puedo ofrecerte las 16:30 con Mario para corte y barba. ¿Quieres confirmar la cita?', time: '10:16' },
        { id: 'booking-3', sender: 'customer', text: 'Sí, confírmala.', time: '10:17' },
        { id: 'booking-4', sender: 'ai', text: 'Tu cita de corte y barba ha quedado confirmada para mañana a las 16:30 con Mario.', time: '10:17' },
        { id: 'booking-5', sender: 'customer', text: 'Perfecto, muchas gracias.', time: '10:18' },
      ],
    },
    {
      id: 'conversation-change', customerId: 'c5', lastMessage: 'Una persona del equipo te ayudará con el cambio.', time: '09:42', status: 'needs_human', unread: 1, interventionReason: 'Solicitud de cambio de una cita existente',
      messages: [
        { id: 'change-1', sender: 'customer', text: 'Necesito cambiar mi cita de esta tarde.', time: '09:41' },
        { id: 'change-2', sender: 'ai', text: 'Una persona del equipo te ayudará con el cambio. Te atenderán en breve.', time: '09:42' },
      ],
    },
    {
      id: 'conversation-service', customerId: 'c6', lastMessage: 'Sí, hacemos afeitado clásico: dura 30 minutos y cuesta 15 €.', time: 'Ayer', status: 'ai_handled', unread: 0,
      messages: [
        { id: 'service-1', sender: 'customer', text: '¿Hacéis afeitado clásico?', time: 'Ayer · 18:04' },
        { id: 'service-2', sender: 'ai', text: 'Sí, hacemos afeitado clásico: dura 30 minutos y cuesta 15 €.', time: 'Ayer · 18:04' },
      ],
    },
    {
      id: 'conversation-manual', customerId: 'c8', lastMessage: 'Quería consultar qué arreglo me recomendáis.', time: '11:05', status: 'needs_human', unread: 2, interventionReason: 'Consulta que necesita valoración del equipo',
      messages: [
        { id: 'manual-1', sender: 'customer', text: 'Tengo la barba bastante larga y no sé qué arreglo elegir.', time: '11:03' },
        { id: 'manual-2', sender: 'ai', text: 'Puedo ayudarte con horarios y servicios, pero el equipo debe valorar qué arreglo te conviene.', time: '11:04' },
        { id: 'manual-3', sender: 'customer', text: 'Quería consultar qué arreglo me recomendáis.', time: '11:05' },
      ],
    },
  ];

  const automationRules: AutomationRule[] = [
    { id: 'r1', name: 'Confirmación inmediata', description: 'Al crear una cita', type: 'appointment', enabled: true },
    { id: 'r2', name: 'Recordatorio 24 horas antes', description: 'Permite confirmar, cambiar o cancelar', type: 'appointment', enabled: true },
    { id: 'r3', name: 'Segundo recordatorio', description: '3 horas antes de la cita', type: 'appointment', enabled: false },
    { id: 'r4', name: 'Corte', description: 'Proponer una nueva cita', type: 'reactivation', enabled: true, daysAfter: 28 },
    { id: 'r5', name: 'Corte + barba', description: 'Proponer una nueva cita', type: 'reactivation', enabled: true, daysAfter: 30 },
  ];

  const timeBlocks: TimeBlock[] = [
    { id: 'block-alex', date: today, start: '14:00', end: '15:00', staffId: 'alex', reason: 'Descanso' },
    { id: 'block-mario', date: tomorrow, start: '13:30', end: '15:00', staffId: 'mario', reason: 'Pausa' },
  ];

  return { today, business, staff, services, customers, appointments, conversations, automationRules, timeBlocks };
}

const initialDemo = createBarberDemoSeed();

export const demoToday = initialDemo.today;
export const business = initialDemo.business;
export const staff = initialDemo.staff;
export const services = initialDemo.services;
export const customers = initialDemo.customers;
export const appointments = initialDemo.appointments;
export const conversations = initialDemo.conversations;
export const automationRules = initialDemo.automationRules;
export const timeBlocks = initialDemo.timeBlocks;
