import {
  CalendarDays,
  ChevronRight,
  Clock3,
  MessageCircle,
  MoreHorizontal,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { Appointment, AppointmentStatus, BeautyRoute, BeautyService, Customer, StaffMember } from '../types';

export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  arrived: 'Ha llegado',
  in_service: 'En servicio',
  completed: 'Finalizada',
  cancelled: 'Cancelada',
  no_show: 'No presentado',
};

export function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <span className={`beauty-status beauty-status--${status}`}>{appointmentStatusLabels[status]}</span>;
}

export function FeatureStateBadge({ state }: { state: 'demo' | 'soon' }) {
  return <span className={`feature-state-badge feature-state-badge--${state}`}>{state === 'demo' ? 'Demo' : 'Próximamente'}</span>;
}

export function Avatar({ name, accent = 'coral', size = 'md' }: { name: string; accent?: StaffMember['accent']; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.split(' ').map((part) => part[0]).join('').slice(0, 2);
  return <span className={`beauty-avatar beauty-avatar--${accent} beauty-avatar--${size}`}>{initials}</span>;
}

interface AppointmentCardProps {
  appointment: Appointment;
  customer: Customer;
  service: BeautyService;
  staffMember: StaffMember;
  onOpen: () => void;
  compact?: boolean;
}

export function AppointmentCard({ appointment, customer, service, staffMember, onOpen, compact = false }: AppointmentCardProps) {
  return (
    <button className={`appointment-card appointment-card--${staffMember.accent} ${compact ? 'appointment-card--compact' : ''}`} onClick={onOpen} type="button">
      <span className="appointment-card__time">
        <strong>{appointment.start}</strong>
        <small>{appointment.end}</small>
      </span>
      <span className="appointment-card__content">
        <span className="appointment-card__topline">
          <strong>{service.name}</strong>
          <MoreHorizontal aria-hidden="true" size={18} />
        </span>
        <span className="appointment-card__customer">{customer.name}</span>
        <span className="appointment-card__meta">
          <Avatar accent={staffMember.accent} name={staffMember.name} size="sm" />
          {staffMember.name}
          {appointment.notes && <span title="Incluye notas">· Nota</span>}
          {appointment.hasReferencePhoto && <span title="Incluye fotografía">· Foto</span>}
        </span>
      </span>
      <StatusBadge status={appointment.status} />
    </button>
  );
}

const navItems: Array<{ route: BeautyRoute; label: string; icon: typeof CalendarDays }> = [
  { route: 'today', label: 'Hoy', icon: Sparkles },
  { route: 'agenda', label: 'Agenda', icon: CalendarDays },
  { route: 'customers', label: 'Clientes', icon: UsersRound },
  { route: 'messages', label: 'Mensajes', icon: MessageCircle },
  { route: 'more', label: 'Más', icon: MoreHorizontal },
];

export function BeautyNavigation({ active, onNavigate }: { active: BeautyRoute; onNavigate: (route: BeautyRoute) => void }) {
  return (
    <nav className="beauty-navigation" aria-label="Navegación principal">
      {navItems.map(({ route, label, icon: Icon }) => (
        <button aria-current={active === route ? 'page' : undefined} className={active === route ? 'is-active' : ''} key={route} onClick={() => onNavigate(route)} type="button">
          <Icon aria-hidden="true" size={21} strokeWidth={active === route ? 2.3 : 1.8} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function MetricCard({ icon, label, value, tone = 'coral' }: { icon: ReactNode; label: string; value: string | number; tone?: 'coral' | 'sage' | 'sand' | 'lilac' }) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <span className="metric-card__icon">{icon}</span>
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

export function EmptySlot({ start, end, staffName }: { start: string; end: string; staffName?: string }) {
  return (
    <div className="empty-slot">
      <Clock3 size={17} />
      <span><strong>{start}–{end}</strong> Disponible{staffName ? ` · ${staffName}` : ''}</span>
    </div>
  );
}

export function DetailRow({ icon, label, value }: { icon?: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="detail-row">
      <span className="detail-row__icon">{icon ?? <ChevronRight size={16} />}</span>
      <span><small>{label}</small><strong>{value}</strong></span>
    </div>
  );
}

export function Sheet({ children, title, subtitle, onClose, wide = false }: { children: ReactNode; title: string; subtitle?: string; onClose: () => void; wide?: boolean }) {
  return (
    <div className="beauty-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <section aria-label={title} aria-modal="true" className={`beauty-sheet ${wide ? 'beauty-sheet--wide' : ''}`} onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header className="beauty-sheet__header">
          <div>
            <p>{subtitle}</p>
            <h2>{title}</h2>
          </div>
          <button aria-label="Cerrar" className="icon-button-soft" onClick={onClose} type="button"><X size={21} /></button>
        </header>
        <div className="beauty-sheet__body">{children}</div>
      </section>
    </div>
  );
}

export function CustomerIdentity({ customer, large = false }: { customer: Customer; large?: boolean }) {
  return (
    <span className="customer-identity">
      <Avatar accent={customer.recurrent ? 'coral' : 'sand'} name={customer.name} size={large ? 'lg' : 'md'} />
      <span><strong>{customer.name}</strong><small>{customer.maskedPhone}</small></span>
      {customer.recurrent && <span className="loyal-tag">Recurrente</span>}
    </span>
  );
}

export function PageHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <header className="page-heading">
      <div>{eyebrow && <p>{eyebrow}</p>}<h1>{title}</h1></div>
      {action}
    </header>
  );
}

export const Icons = { CalendarDays, Clock3, MessageCircle, Sparkles, UserRound, UsersRound };
