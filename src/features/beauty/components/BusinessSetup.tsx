import { ArrowLeft, CalendarOff, Copy, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Appointment, BeautyService, StaffMember } from '../types';
import type { ServiceInput, StaffInput, StaffSchedule, StaffServiceAssignment, WeeklyScheduleSegmentInput } from '../data/types';
import { Avatar, FeatureStateBadge, PageHeader } from './ui';

const days = [
  { value: 1, label: 'Lunes' }, { value: 2, label: 'Martes' }, { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' }, { value: 5, label: 'Viernes' }, { value: 6, label: 'Sábado' }, { value: 7, label: 'Domingo' },
];

function ErrorText({ value }: { value: string }) {
  return value ? <p className="form-error" role="alert">{value}</p> : null;
}

export function StaffManagementPage({ appointments, canManage, mode, onBack, onCreate, onDeactivate, onOpenSchedules, onSetAssignment, onUpdate, services, staff, staffServices }: {
  appointments: Appointment[]; canManage: boolean; mode: 'mock' | 'supabase'; onBack: () => void;
  onCreate: (value: StaffInput) => Promise<string>; onUpdate: (value: StaffInput & { staffId: string; active: boolean }) => Promise<string>;
  onDeactivate: (staffId: string) => Promise<string>; onSetAssignment: (value: { staffId: string; serviceId: string; durationMinutes: number | null; price: number | null; active: boolean }) => Promise<string>;
  onOpenSchedules: (staffId: string) => void; services: BeautyService[]; staff: StaffMember[]; staffServices: StaffServiceAssignment[];
}) {
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const [error, setError] = useState('');
  const visible = staff.filter((item) => (showInactive || item.active !== false) && item.name.toLowerCase().includes(query.toLowerCase()));
  const today = new Intl.DateTimeFormat('en-CA').format(new Date());
  const upcoming = (id: string) => appointments.filter((item) => item.staffId === id && item.date >= today && !['completed', 'cancelled', 'no_show'].includes(item.status)).length;

  async function save(value: StaffInput & { active: boolean }) {
    setError('');
    try {
      if (editing === 'new') await onCreate(value);
      else if (editing) await onUpdate({ ...value, staffId: editing.id });
      setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No hemos podido guardar el profesional.'); }
  }

  return <div className="beauty-page setup-page">
    <PageHeader eyebrow="Configura tu equipo" title="Profesionales" action={<div className="heading-actions">{mode === 'mock' && <FeatureStateBadge state="demo" />}<button aria-label="Volver" className="icon-button-soft" onClick={onBack}><ArrowLeft /></button></div>} />
    <div className="setup-toolbar"><label className="beauty-search"><Search size={18} /><input onChange={(e) => setQuery(e.target.value)} placeholder="Buscar profesional" value={query} /></label><button disabled={!canManage} onClick={() => setEditing('new')}><Plus size={17} />Nuevo</button></div>
    <label className="inactive-filter"><input checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} type="checkbox" />Mostrar inactivos</label>
    <div className="setup-list">{visible.map((member) => <article className={member.active === false ? 'is-inactive' : ''} key={member.id}>
      <Avatar accent={member.accent} name={member.name} /><span><strong>{member.name}</strong><small>{member.email || member.phone || 'Sin contacto'} · {upcoming(member.id)} citas próximas</small></span>
      <button onClick={() => setEditing(member)}>Gestionar</button>
    </article>)}</div>
    {editing && <div className="inline-editor"><StaffEditor member={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSave={save} />
      {editing !== 'new' && <>
        <section><h3>Servicios asignados</h3><div className="assignment-list">{services.filter((service) => service.active !== false).map((service) => {
          const assignment = staffServices.find((item) => item.staffId === editing.id && item.serviceId === service.id);
          return <AssignmentEditor assignment={assignment} key={service.id} onSave={(durationMinutes, price, active) => onSetAssignment({ staffId: editing.id, serviceId: service.id, durationMinutes, price, active })} service={service} />;
        })}</div></section>
        <div className="detail-actions"><button onClick={() => onOpenSchedules(editing.id)}>Ver horario semanal</button><button className="danger-action" disabled={editing.active === false} onClick={() => { if (window.confirm(`¿Desactivar a ${editing.name}? Dejará de estar disponible para citas nuevas.`)) void onDeactivate(editing.id).then(() => setEditing(null)).catch((cause) => setError(cause instanceof Error ? cause.message : 'No se puede desactivar.')); }}>Desactivar</button></div>
      </>}
      <ErrorText value={error} />
    </div>}
  </div>;
}

function StaffEditor({ member, onCancel, onSave }: { member?: StaffMember; onCancel: () => void; onSave: (value: StaffInput & { active: boolean }) => Promise<void> }) {
  const [name, setName] = useState(member?.name ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [email, setEmail] = useState(member?.email ?? '');
  const [colorKey, setColorKey] = useState<StaffInput['colorKey']>(member?.accent ?? 'coral');
  const [sortOrder, setSortOrder] = useState(member?.sortOrder ?? 0);
  const [active, setActive] = useState(member?.active !== false);
  return <form className="beauty-command-form" onSubmit={(e) => { e.preventDefault(); void onSave({ name, phone, email, colorKey, sortOrder, active }); }}>
    <h2>{member ? 'Editar profesional' : 'Nuevo profesional'}</h2>
    <label><span>Nombre *</span><input maxLength={160} onChange={(e) => setName(e.target.value)} required value={name} /></label>
    <div className="form-columns"><label><span>Teléfono</span><input onChange={(e) => setPhone(e.target.value)} value={phone} /></label><label><span>Email</span><input onChange={(e) => setEmail(e.target.value)} type="email" value={email} /></label></div>
    <div className="form-columns"><label><span>Color</span><select onChange={(e) => setColorKey(e.target.value as StaffInput['colorKey'])} value={colorKey}><option value="coral">Coral</option><option value="sage">Verde</option><option value="sand">Arena</option></select></label><label><span>Orden</span><input min={0} max={999} onChange={(e) => setSortOrder(Number(e.target.value))} type="number" value={sortOrder} /></label></div>
    {member?.active === false && <label className="check-row"><input checked={active} onChange={(e) => setActive(e.target.checked)} type="checkbox" />Reactivar profesional</label>}
    <div className="form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button type="submit">Guardar</button></div>
  </form>;
}

function AssignmentEditor({ assignment, onSave, service }: { assignment?: StaffServiceAssignment; onSave: (duration: number | null, price: number | null, active: boolean) => Promise<string>; service: BeautyService }) {
  const [active, setActive] = useState(assignment?.active ?? false);
  const [duration, setDuration] = useState(assignment?.durationMinutes ?? service.durationMinutes);
  const [price, setPrice] = useState(assignment?.price ?? service.price);
  return <article><label><input checked={active} onChange={(e) => setActive(e.target.checked)} type="checkbox" /><strong>{service.name}</strong></label><input aria-label={`Duración ${service.name}`} min={1} onChange={(e) => setDuration(Number(e.target.value))} type="number" value={duration} /><input aria-label={`Precio ${service.name}`} min={0} onChange={(e) => setPrice(Number(e.target.value))} step=".01" type="number" value={price} /><button onClick={() => void onSave(duration === service.durationMinutes ? null : duration, price === service.price ? null : price, active)}>Guardar</button></article>;
}

export function ServicesManagementPage({ canManage, mode, onBack, onCreate, onDeactivate, onUpdate, services, staffServices }: {
  canManage: boolean; mode: 'mock' | 'supabase'; onBack: () => void; services: BeautyService[]; staffServices: StaffServiceAssignment[];
  onCreate: (value: ServiceInput) => Promise<string>; onUpdate: (value: ServiceInput & { serviceId: string; active: boolean }) => Promise<string>; onDeactivate: (id: string) => Promise<string>;
}) {
  const [editing, setEditing] = useState<BeautyService | 'new' | null>(null); const [query, setQuery] = useState(''); const [showInactive, setShowInactive] = useState(false); const [error, setError] = useState('');
  const visible = services.filter((item) => (showInactive || item.active !== false) && item.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="beauty-page setup-page"><PageHeader eyebrow="Catálogo del salón" title="Servicios" action={<div className="heading-actions">{mode === 'mock' && <FeatureStateBadge state="demo" />}<button aria-label="Volver" className="icon-button-soft" onClick={onBack}><ArrowLeft /></button></div>} />
    <div className="setup-toolbar"><label className="beauty-search"><Search size={18} /><input placeholder="Buscar servicio" value={query} onChange={(e) => setQuery(e.target.value)} /></label><button disabled={!canManage} onClick={() => setEditing('new')}><Plus size={17} />Nuevo</button></div>
    <label className="inactive-filter"><input checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} type="checkbox" />Mostrar inactivos</label>
    <div className="setup-list">{visible.map((service) => <article className={service.active === false ? 'is-inactive' : ''} key={service.id}><span><strong>{service.name}</strong><small>{service.durationMinutes} min · {service.price} {service.currency === 'EUR' || !service.currency ? '€' : service.currency} · {staffServices.filter((item) => item.serviceId === service.id && item.active).length} profesionales</small></span><button onClick={() => setEditing(service)}>Gestionar</button></article>)}</div>
    {editing && <div className="inline-editor"><ServiceEditor onCancel={() => setEditing(null)} onSave={async (value) => { setError(''); try { if (editing === 'new') await onCreate(value); else await onUpdate({ ...value, serviceId: editing.id, active: editing.active !== false }); setEditing(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se puede guardar.'); } }} service={editing === 'new' ? undefined : editing} />{editing !== 'new' && <button className="danger-inline" disabled={editing.active === false} onClick={() => { if (window.confirm(`¿Desactivar ${editing.name}? Dejará de estar disponible para citas nuevas.`)) void onDeactivate(editing.id).then(() => setEditing(null)).catch((cause) => setError(cause instanceof Error ? cause.message : 'No se puede desactivar.')); }}>Desactivar servicio</button>}<ErrorText value={error} /></div>}
  </div>;
}

function ServiceEditor({ onCancel, onSave, service }: { onCancel: () => void; onSave: (value: ServiceInput) => Promise<void>; service?: BeautyService }) {
  const [value, setValue] = useState<ServiceInput>({ name: service?.name ?? '', description: service?.description ?? '', durationMinutes: service?.durationMinutes ?? 60, bufferBeforeMinutes: service?.bufferBeforeMinutes ?? 0, bufferAfterMinutes: service?.bufferAfterMinutes ?? 0, price: service?.price ?? 0, currency: service?.currency ?? 'EUR', onlineBookingEnabled: service?.onlineBookingEnabled ?? true, reactivationDays: service?.reactivationDays ?? null });
  const set = <K extends keyof ServiceInput>(key: K, next: ServiceInput[K]) => setValue((current) => ({ ...current, [key]: next }));
  return <form className="beauty-command-form" onSubmit={(e) => { e.preventDefault(); void onSave(value); }}><h2>{service ? 'Editar servicio' : 'Nuevo servicio'}</h2>
    <label><span>Nombre *</span><input required value={value.name} onChange={(e) => set('name', e.target.value)} /></label><label><span>Descripción</span><textarea value={value.description} onChange={(e) => set('description', e.target.value)} /></label>
    <div className="form-columns"><label><span>Duración</span><input min={1} type="number" value={value.durationMinutes} onChange={(e) => set('durationMinutes', Number(e.target.value))} /></label><label><span>Precio</span><input min={0} step=".01" type="number" value={value.price} onChange={(e) => set('price', Number(e.target.value))} /></label></div>
    <div className="form-columns"><label><span>Buffer antes</span><input min={0} type="number" value={value.bufferBeforeMinutes} onChange={(e) => set('bufferBeforeMinutes', Number(e.target.value))} /></label><label><span>Buffer después</span><input min={0} type="number" value={value.bufferAfterMinutes} onChange={(e) => set('bufferAfterMinutes', Number(e.target.value))} /></label></div>
    <div className="form-columns"><label><span>Moneda</span><input maxLength={3} value={value.currency} onChange={(e) => set('currency', e.target.value.toUpperCase())} /></label><label><span>Reactivación (días)</span><input min={1} type="number" value={value.reactivationDays ?? ''} onChange={(e) => set('reactivationDays', e.target.value ? Number(e.target.value) : null)} /></label></div>
    <label className="check-row"><input checked={value.onlineBookingEnabled} type="checkbox" onChange={(e) => set('onlineBookingEnabled', e.target.checked)} />Permitir reserva online</label><div className="form-actions"><button type="button" onClick={onCancel}>Cancelar</button><button type="submit">Guardar</button></div>
  </form>;
}

export function SchedulesManagementPage({ initialStaffId, mode, onBack, onCreateAbsence, onSave, schedules, staff }: { initialStaffId?: string; mode: 'mock' | 'supabase'; onBack: () => void; onCreateAbsence: (staffId: string) => void; onSave: (staffId: string, segments: WeeklyScheduleSegmentInput[]) => Promise<void>; schedules: StaffSchedule[]; staff: StaffMember[] }) {
  const activeStaff = staff.filter((item) => item.active !== false); const [staffId, setStaffId] = useState(initialStaffId ?? activeStaff[0]?.id ?? ''); const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const initial = useMemo(() => schedules.filter((item) => item.staffId === staffId && item.active).map((item) => ({ dayOfWeek: item.dayOfWeek, start: item.start, end: item.end })), [schedules, staffId]);
  const [segments, setSegments] = useState<WeeklyScheduleSegmentInput[]>(initial);
  function selectStaff(id: string) { setStaffId(id); setSegments(schedules.filter((item) => item.staffId === id && item.active).map((item) => ({ dayOfWeek: item.dayOfWeek, start: item.start, end: item.end }))); }
  return <div className="beauty-page setup-page"><PageHeader eyebrow="Semana habitual" title="Horarios" action={<div className="heading-actions">{mode === 'mock' && <FeatureStateBadge state="demo" />}<button aria-label="Volver" className="icon-button-soft" onClick={onBack}><ArrowLeft /></button></div>} />
    <label><span>Profesional</span><select value={staffId} onChange={(e) => selectStaff(e.target.value)}>{activeStaff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="weekly-editor">{days.map((day) => { const daySegments = segments.filter((item) => item.dayOfWeek === day.value); return <section key={day.value}><header><strong>{day.label}</strong><button onClick={() => setSegments((current) => [...current, { dayOfWeek: day.value, start: '09:00', end: '14:00' }])}><Plus size={15} />Tramo</button></header>{daySegments.length ? daySegments.map((segment) => { const index = segments.indexOf(segment); return <div className="schedule-segment" key={`${day.value}-${index}`}><input type="time" value={segment.start} onChange={(e) => setSegments((current) => current.map((item, i) => i === index ? { ...item, start: e.target.value } : item))} /><span>–</span><input type="time" value={segment.end} onChange={(e) => setSegments((current) => current.map((item, i) => i === index ? { ...item, end: e.target.value } : item))} /><button aria-label={`Eliminar tramo ${day.label}`} onClick={() => setSegments((current) => current.filter((_, i) => i !== index))}><Trash2 size={16} /></button></div>; }) : <small>Día libre</small>}<button className="copy-day" disabled={!daySegments.length} onClick={() => { const source = segments.filter((item) => item.dayOfWeek === day.value); setSegments(days.flatMap((target) => source.map((item) => ({ ...item, dayOfWeek: target.value })))); }}><Copy size={14} />Copiar a toda la semana</button></section>; })}</div>
    <ErrorText value={error} /><div className="form-actions"><button onClick={() => onCreateAbsence(staffId)}><CalendarOff size={16} />Ausencia o vacaciones</button><button disabled={saving || !staffId} onClick={() => { setSaving(true); setError(''); void onSave(staffId, segments).catch((cause) => setError(cause instanceof Error ? cause.message : 'No se puede guardar el horario.')).finally(() => setSaving(false)); }}>{saving ? 'Guardando…' : 'Guardar horario'}</button></div>
  </div>;
}
