export type BeautyRoute = 'today' | 'agenda' | 'customers' | 'messages' | 'more' | 'automations';
export type AppointmentStatus = 'pending' | 'confirmed' | 'arrived' | 'in_service' | 'completed' | 'cancelled' | 'no_show';
export type ConversationStatus = 'ai_handled' | 'waiting_customer' | 'needs_human' | 'human_handled' | 'closed';

export interface BeautyBusiness {
  id: string;
  name: string;
  ownerName: string;
  assistantActive: boolean;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  initials: string;
  accent: 'coral' | 'sage' | 'sand';
}

export interface BeautyService {
  id: string;
  name: string;
  durationMinutes: number;
  price: number;
  category: 'hair' | 'barber' | 'nails';
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  maskedPhone: string;
  lastVisit: string;
  recommendedService: string;
  nextAppointmentId?: string;
  recurrent: boolean;
  preferredStaffId?: string;
  notes: string;
  messagingConsent: boolean;
  nextReactivation: string;
  usualServices: string[];
  appointmentCount?: number;
}

export interface AppointmentHistoryItem {
  id: string;
  label: string;
  at: string;
}

export interface Appointment {
  id: string;
  date: string;
  start: string;
  end: string;
  customerId: string;
  serviceId: string;
  serviceIds?: string[];
  staffId: string;
  status: AppointmentStatus;
  notes?: string;
  hasReferencePhoto?: boolean;
  source: 'WhatsApp IA' | 'Manual' | 'Teléfono';
  history: AppointmentHistoryItem[];
  totalDurationMinutes?: number;
  totalPrice?: number;
  currency?: string;
  historyLoaded?: boolean;
  historyError?: boolean;
}

export interface ConversationMessage {
  id: string;
  sender: 'customer' | 'ai' | 'human';
  text: string;
  time: string;
}

export interface Conversation {
  id: string;
  customerId: string;
  lastMessage: string;
  time: string;
  status: ConversationStatus;
  unread: number;
  interventionReason?: string;
  messages: ConversationMessage[];
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string;
  type: 'appointment' | 'reactivation';
  enabled: boolean;
  daysAfter?: number;
}

export interface TimeBlock {
  id: string;
  date: string;
  start: string;
  end: string;
  staffId: string;
  reason: string;
}
