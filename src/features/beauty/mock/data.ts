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

export const demoToday = '2026-07-28';

export const business: BeautyBusiness = {
  id: 'beauty-demo',
  name: 'Luna Beauty Studio',
  ownerName: 'Laura',
  assistantActive: true,
};

export const staff: StaffMember[] = [
  { id: 'laura', name: 'Laura', role: 'Estilista', initials: 'LA', accent: 'coral' },
  { id: 'marta', name: 'Marta', role: 'Colorista', initials: 'MA', accent: 'sage' },
  { id: 'ana', name: 'Ana', role: 'Nail artist', initials: 'AN', accent: 'sand' },
];

export const services: BeautyService[] = [
  { id: 'corte-mujer', name: 'Corte mujer', durationMinutes: 45, price: 32, category: 'hair' },
  { id: 'corte-caballero', name: 'Corte caballero', durationMinutes: 30, price: 20, category: 'barber' },
  { id: 'corte-barba', name: 'Corte y barba', durationMinutes: 50, price: 29, category: 'barber' },
  { id: 'tinte', name: 'Tinte', durationMinutes: 90, price: 58, category: 'hair' },
  { id: 'mechas', name: 'Mechas', durationMinutes: 150, price: 89, category: 'hair' },
  { id: 'peinado', name: 'Peinado', durationMinutes: 45, price: 30, category: 'hair' },
  { id: 'manicura-semi', name: 'Manicura semipermanente', durationMinutes: 60, price: 28, category: 'nails' },
  { id: 'unas-gel', name: 'Uñas de gel', durationMinutes: 90, price: 42, category: 'nails' },
];

export const customers: Customer[] = [
  { id: 'c1', name: 'Marina Soler', phone: '+34 611 102 304', maskedPhone: '+34 611 *** 304', lastVisit: '12 jul', recommendedService: 'Tinte', nextAppointmentId: 'a1', recurrent: true, preferredStaffId: 'marta', notes: 'Prefiere tonos cálidos.', messagingConsent: true, nextReactivation: '18 ago', usualServices: ['Tinte', 'Peinado'] },
  { id: 'c2', name: 'Claudia Ríos', phone: '+34 622 215 480', maskedPhone: '+34 622 *** 480', lastVisit: '03 jul', recommendedService: 'Manicura semipermanente', nextAppointmentId: 'a2', recurrent: true, preferredStaffId: 'ana', notes: 'Le gustan diseños minimalistas.', messagingConsent: true, nextReactivation: '20 ago', usualServices: ['Manicura semipermanente'] },
  { id: 'c3', name: 'Daniel Vega', phone: '+34 633 401 728', maskedPhone: '+34 633 *** 728', lastVisit: '28 jun', recommendedService: 'Corte y barba', nextAppointmentId: 'a3', recurrent: true, preferredStaffId: 'laura', notes: 'Degradado bajo.', messagingConsent: true, nextReactivation: '27 ago', usualServices: ['Corte y barba'] },
  { id: 'c4', name: 'Elena Castro', phone: '+34 644 307 918', maskedPhone: '+34 644 *** 918', lastVisit: '18 may', recommendedService: 'Mechas', nextAppointmentId: 'a4', recurrent: false, preferredStaffId: 'marta', notes: 'Primera visita tras consulta.', messagingConsent: true, nextReactivation: '10 sep', usualServices: ['Mechas'] },
  { id: 'c5', name: 'Sara Molina', phone: '+34 655 224 609', maskedPhone: '+34 655 *** 609', lastVisit: '21 jul', recommendedService: 'Corte mujer', nextAppointmentId: 'a5', recurrent: true, preferredStaffId: 'laura', notes: 'Cabello rizado.', messagingConsent: true, nextReactivation: '28 ago', usualServices: ['Corte mujer', 'Peinado'] },
  { id: 'c6', name: 'Nuria Campos', phone: '+34 666 513 802', maskedPhone: '+34 666 *** 802', lastVisit: '06 jul', recommendedService: 'Uñas de gel', nextAppointmentId: 'a6', recurrent: true, preferredStaffId: 'ana', notes: 'Forma almendrada corta.', messagingConsent: true, nextReactivation: '15 ago', usualServices: ['Uñas de gel'] },
  { id: 'c7', name: 'Javier León', phone: '+34 677 330 415', maskedPhone: '+34 677 *** 415', lastVisit: '02 jul', recommendedService: 'Corte caballero', recurrent: false, preferredStaffId: 'laura', notes: '', messagingConsent: false, nextReactivation: '01 sep', usualServices: ['Corte caballero'] },
  { id: 'c8', name: 'Alicia Mora', phone: '+34 688 209 731', maskedPhone: '+34 688 *** 731', lastVisit: '19 jul', recommendedService: 'Peinado', recurrent: true, preferredStaffId: 'marta', notes: 'Evitar productos con perfume intenso.', messagingConsent: true, nextReactivation: '30 ago', usualServices: ['Peinado', 'Tinte'] },
  { id: 'c9', name: 'Paula Ferrer', phone: '+34 699 713 526', maskedPhone: '+34 699 *** 526', lastVisit: '10 jun', recommendedService: 'Manicura semipermanente', recurrent: false, preferredStaffId: 'ana', notes: '', messagingConsent: true, nextReactivation: '05 ago', usualServices: ['Manicura semipermanente'] },
  { id: 'c10', name: 'Lucía Pastor', phone: '+34 610 884 123', maskedPhone: '+34 610 *** 123', lastVisit: '14 jul', recommendedService: 'Corte mujer', nextAppointmentId: 'a10', recurrent: true, preferredStaffId: 'laura', notes: 'Flequillo largo.', messagingConsent: true, nextReactivation: '25 ago', usualServices: ['Corte mujer'] },
];

export const appointments: Appointment[] = [
  { id: 'a1', date: demoToday, start: '09:00', end: '10:30', customerId: 'c1', serviceId: 'tinte', staffId: 'marta', status: 'confirmed', notes: 'Aplicar tono 7.3.', hasReferencePhoto: true, source: 'WhatsApp IA', history: [{ id: 'h1', label: 'Confirmada por WhatsApp', at: 'Ayer · 18:42' }] },
  { id: 'a2', date: demoToday, start: '09:30', end: '10:30', customerId: 'c2', serviceId: 'manicura-semi', staffId: 'ana', status: 'arrived', notes: 'Diseño nude.', source: 'WhatsApp IA', history: [{ id: 'h2', label: 'Cliente ha llegado', at: '09:24' }] },
  { id: 'a3', date: demoToday, start: '10:45', end: '11:35', customerId: 'c3', serviceId: 'corte-barba', staffId: 'laura', status: 'in_service', source: 'Manual', history: [{ id: 'h3', label: 'Servicio iniciado', at: '10:47' }] },
  { id: 'a4', date: demoToday, start: '12:00', end: '14:30', customerId: 'c4', serviceId: 'mechas', staffId: 'marta', status: 'pending', notes: 'Trae fotografía de referencia.', hasReferencePhoto: true, source: 'Teléfono', history: [{ id: 'h4', label: 'Cita creada', at: '26 jul · 11:10' }] },
  { id: 'a5', date: demoToday, start: '15:30', end: '16:15', customerId: 'c5', serviceId: 'corte-mujer', staffId: 'laura', status: 'confirmed', source: 'WhatsApp IA', history: [{ id: 'h5', label: 'Recordatorio enviado', at: 'Ayer · 15:30' }] },
  { id: 'a6', date: demoToday, start: '16:00', end: '17:30', customerId: 'c6', serviceId: 'unas-gel', staffId: 'ana', status: 'confirmed', notes: 'Retirada incluida.', source: 'WhatsApp IA', history: [{ id: 'h6', label: 'Confirmada', at: '25 jul · 19:04' }] },
  { id: 'a7', date: demoToday, start: '17:00', end: '17:30', customerId: 'c7', serviceId: 'corte-caballero', staffId: 'laura', status: 'cancelled', source: 'Manual', history: [{ id: 'h7', label: 'Cancelada con antelación', at: '08:12' }] },
  { id: 'a8', date: '2026-07-27', start: '11:00', end: '11:45', customerId: 'c8', serviceId: 'peinado', staffId: 'marta', status: 'completed', source: 'Teléfono', history: [{ id: 'h8', label: 'Servicio finalizado', at: '11:47' }] },
  { id: 'a9', date: '2026-07-27', start: '17:30', end: '18:30', customerId: 'c9', serviceId: 'manicura-semi', staffId: 'ana', status: 'no_show', source: 'WhatsApp IA', history: [{ id: 'h9', label: 'Marcada como no presentada', at: '17:45' }] },
  { id: 'a10', date: '2026-07-29', start: '10:00', end: '10:45', customerId: 'c10', serviceId: 'corte-mujer', staffId: 'laura', status: 'confirmed', source: 'WhatsApp IA', history: [{ id: 'h10', label: 'Confirmada', at: 'Hoy · 09:10' }] },
  { id: 'a11', date: '2026-07-29', start: '12:30', end: '14:00', customerId: 'c1', serviceId: 'tinte', staffId: 'marta', status: 'pending', source: 'Manual', history: [{ id: 'h11', label: 'Cita creada', at: 'Hoy · 10:05' }] },
  { id: 'a12', date: '2026-07-30', start: '16:30', end: '18:00', customerId: 'c6', serviceId: 'unas-gel', staffId: 'ana', status: 'confirmed', source: 'WhatsApp IA', history: [{ id: 'h12', label: 'Confirmada', at: 'Hoy · 08:50' }] },
];

export const conversations: Conversation[] = [
  { id: 'm1', customerId: 'c4', lastMessage: '¿Podéis aconsejarme el tono?', time: '11:42', status: 'needs_human', unread: 2, interventionReason: 'Consulta técnica sobre color', messages: [{ id: 'mm1', sender: 'customer', text: 'Hola, tengo una foto y no sé qué tono elegir.', time: '11:38' }, { id: 'mm2', sender: 'ai', text: 'Puedo ayudarte con la cita, pero una profesional debe aconsejarte sobre el tono.', time: '11:39' }, { id: 'mm3', sender: 'customer', text: '¿Podéis aconsejarme el tono?', time: '11:42' }] },
  { id: 'm2', customerId: 'c2', lastMessage: 'Perfecto, allí estaré.', time: '10:12', status: 'ai_handled', unread: 0, messages: [{ id: 'mm4', sender: 'ai', text: 'Tu cita está confirmada para hoy a las 09:30.', time: '08:40' }, { id: 'mm5', sender: 'customer', text: 'Perfecto, allí estaré.', time: '10:12' }] },
  { id: 'm3', customerId: 'c7', lastMessage: '¿Tenéis hueco el jueves?', time: '09:54', status: 'waiting_customer', unread: 1, messages: [{ id: 'mm6', sender: 'customer', text: '¿Tenéis hueco el jueves?', time: '09:54' }, { id: 'mm7', sender: 'ai', text: 'Sí. ¿Prefieres mañana o tarde?', time: '09:54' }] },
  { id: 'm4', customerId: 'c5', lastMessage: 'Gracias por cambiarla.', time: 'Ayer', status: 'human_handled', unread: 0, messages: [{ id: 'mm8', sender: 'human', text: 'Ya está cambiada a las 15:30.', time: 'Ayer · 17:20' }, { id: 'mm9', sender: 'customer', text: 'Gracias por cambiarla.', time: 'Ayer · 17:22' }] },
  { id: 'm5', customerId: 'c9', lastMessage: 'Lo revisaré más adelante.', time: 'Ayer', status: 'closed', unread: 0, messages: [{ id: 'mm10', sender: 'customer', text: 'Lo revisaré más adelante.', time: 'Ayer · 12:04' }] },
  { id: 'm6', customerId: 'c1', lastMessage: 'Te esperamos mañana a las 12:30.', time: 'Lun', status: 'ai_handled', unread: 0, messages: [{ id: 'mm11', sender: 'ai', text: 'Te esperamos mañana a las 12:30.', time: 'Lun · 18:10' }] },
];

export const automationRules: AutomationRule[] = [
  { id: 'r1', name: 'Confirmación inmediata', description: 'Al crear una cita', type: 'appointment', enabled: true },
  { id: 'r2', name: 'Recordatorio 24 horas antes', description: 'Permite confirmar, cambiar o cancelar', type: 'appointment', enabled: true },
  { id: 'r3', name: 'Segundo recordatorio', description: '3 horas antes de la cita', type: 'appointment', enabled: false },
  { id: 'r4', name: 'Manicura semipermanente', description: 'Proponer una nueva cita', type: 'reactivation', enabled: true, daysAfter: 21 },
  { id: 'r5', name: 'Corte', description: 'Proponer una nueva cita', type: 'reactivation', enabled: true, daysAfter: 30 },
  { id: 'r6', name: 'Tinte', description: 'Proponer una nueva cita', type: 'reactivation', enabled: true, daysAfter: 42 },
  { id: 'r7', name: 'Pestañas', description: 'Proponer una nueva cita', type: 'reactivation', enabled: false, daysAfter: 18 },
];

export const timeBlocks: TimeBlock[] = [
  { id: 'b1', date: demoToday, start: '14:00', end: '15:00', staffId: 'ana', reason: 'Descanso' },
  { id: 'b2', date: demoToday, start: '13:30', end: '15:00', staffId: 'laura', reason: 'Pausa' },
];
