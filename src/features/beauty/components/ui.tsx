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
import { useEffect, useState, type ReactNode } from 'react';
import type { Appointment, AppointmentStatus, BeautyRoute, BeautyService, Customer, StaffMember } from '../types';

export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmada',
  arrived: 'En curso',
  in_service: 'En curso',
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
  onStatusChange: (appointmentId: string, status: 'confirmed' | 'completed' | 'cancelled' | 'no_show') => Promise<void>;
  compact?: boolean;
}

function appointmentPrimaryAction(status: AppointmentStatus) {
  if (status === 'pending') return { label: 'Confirmar', status: 'confirmed' as const };
  if (['confirmed', 'arrived', 'in_service'].includes(status)) return { label: 'Finalizar', status: 'completed' as const };
  return null;
}

export function AppointmentCard({ appointment, customer, service, staffMember, onOpen, onStatusChange, compact = false }: AppointmentCardProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const primaryAction = appointmentPrimaryAction(appointment.status);
  const canCancel = appointment.status === 'pending' || appointment.status === 'confirmed';
  const canMarkNoShow = appointment.status === 'confirmed';

  useEffect(() => {
    setError('');
  }, [appointment.status]);

  async function changeStatus(status: 'confirmed' | 'completed' | 'cancelled' | 'no_show', confirmMessage?: string) {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setSaving(true);
    setError('');
    try {
      await onStatusChange(appointment.id, status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No hemos podido actualizar la cita.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={`appointment-card appointment-card--${staffMember.accent} ${compact ? 'appointment-card--compact' : ''}`}>
      <button className="appointment-card__open" onClick={onOpen} type="button">
        <span className="appointment-card__time">
          <strong>{appointment.start}</strong>
          <small>{appointment.end}</small>
        </span>
        <span className="appointment-card__content">
          <span className="appointment-card__topline"><strong>{service.name}</strong></span>
          <span className="appointment-card__customer">{customer.name}</span>
          <span className="appointment-card__meta">
            <Avatar accent={staffMember.accent} name={staffMember.name} size="sm" />
            {staffMember.name}
            {appointment.notes && <span title="Incluye notas">· Nota</span>}
            {appointment.hasReferencePhoto && <span title="Incluye fotografía">· Foto</span>}
          </span>
        </span>
      </button>
      <div className="appointment-card__state"><StatusBadge status={appointment.status} /></div>
      <div className="appointment-card__actions">
        {primaryAction && <button className="appointment-card__primary" disabled={saving} onClick={() => void changeStatus(primaryAction.status)} type="button">{saving ? 'Guardando…' : primaryAction.label}</button>}
        <details className="appointment-card__menu">
          <summary aria-label={`Más acciones para ${customer.name}`}><MoreHorizontal aria-hidden="true" size={18} /></summary>
          <div>
            {canMarkNoShow && <button disabled={saving} onClick={() => void changeStatus('no_show', '¿Marcar esta cita como no presentada?')} type="button">No presentado</button>}
            {canCancel && <button className="danger-action" disabled={saving} onClick={() => void changeStatus('cancelled', '¿Cancelar esta cita? El hueco volverá a quedar disponible.')} type="button">Cancelar</button>}
            {['pending', 'confirmed'].includes(appointment.status) && <button disabled type="button">Reprogramar <small>Próximamente</small></button>}
            <button onClick={onOpen} type="button">Ver detalle</button>
          </div>
        </details>
      </div>
      {error && <p className="appointment-card__error" role="alert">{error}</p>}
    </article>
  );
}

const navItems: Array<{ route: BeautyRoute; label: string; icon: typeof CalendarDays }> = [
  { route: 'today', label: 'Hoy', icon: Sparkles },
  { route: 'agenda', label: 'Agenda', icon: CalendarDays },
  { route: 'messages', label: 'Mensajes', icon: MessageCircle },
  { route: 'customers', label: 'Clientes', icon: UsersRound },
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

export function Sheet({ bodyClassName = '', children, title, subtitle, onClose, wide = false }: { bodyClassName?: string; children: ReactNode; title: string; subtitle?: string; onClose: () => void; wide?: boolean }) {
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
        <div className={`beauty-sheet__body ${bodyClassName}`.trim()}>{children}</div>
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
