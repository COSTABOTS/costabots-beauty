import {
  ArrowLeft,
  BellRing,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Clock3,
  Image,
  LockKeyhole,
  MessageCircle,
  Phone,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
  WandSparkles,
} from 'lucide-react';
import { useState } from 'react';
import { beautyEnvironment } from '../../config/environment';
import {
  appointments as initialAppointments,
  automationRules as initialAutomationRules,
  business,
  conversations as initialConversations,
  customers,
  demoToday,
  services,
  staff,
  timeBlocks,
} from './mock/data';
import type { Appointment, AppointmentStatus, BeautyRoute, Conversation, ConversationStatus, Customer } from './types';
import {
  AppointmentCard,
  Avatar,
  BeautyNavigation,
  CustomerIdentity,
  DetailRow,
  EmptySlot,
  MetricCard,
  PageHeader,
  Sheet,
  StatusBadge,
} from './components/ui';
import './beauty.css';

const dates = ['2026-07-27', demoToday, '2026-07-29', '2026-07-30'];
const dateLabels: Record<string, string> = {
  '2026-07-27': 'Lunes, 27 de julio',
  [demoToday]: 'Martes, 28 de julio',
  '2026-07-29': 'Miércoles, 29 de julio',
  '2026-07-30': 'Jueves, 30 de julio',
};

function findCustomer(id: string) {
  return customers.find((customer) => customer.id === id)!;
}

function findService(id: string) {
  return services.find((service) => service.id === id)!;
}

function findStaff(id: string) {
  return staff.find((member) => member.id === id)!;
}

function Kicker({ children }: { children: string }) {
  return <p className="section-kicker">{children}</p>;
}

export function BeautyApp() {
  void beautyEnvironment.productId;
  const [route, setRoute] = useState<BeautyRoute>('today');
  const [appointments, setAppointments] = useState(initialAppointments);
  const [conversations, setConversations] = useState(initialConversations);
  const [automationRules, setAutomationRules] = useState(initialAutomationRules);
  const [selectedDate, setSelectedDate] = useState(demoToday);
  const [staffFilter, setStaffFilter] = useState('all');
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [toast, setToast] = useState('');

  const selectedAppointment = appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null;
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2300);
  }

  function navigate(nextRoute: BeautyRoute) {
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateAppointmentStatus(status: AppointmentStatus) {
    if (!selectedAppointment) return;
    setAppointments((current) => current.map((appointment) => appointment.id === selectedAppointment.id ? {
      ...appointment,
      status,
      history: [{ id: `local-${Date.now()}`, label: `Estado cambiado a ${status}`, at: 'Ahora' }, ...appointment.history],
    } : appointment));
    showToast('Estado actualizado localmente');
  }

  function updateConversationStatus(id: string, status: ConversationStatus) {
    setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, status, unread: 0 } : conversation));
    showToast(status === 'human_handled' ? 'Ahora atiendes esta conversación' : 'La conversación vuelve a la IA');
  }

  return (
    <div className="beauty-app">
      <aside className="desktop-brand">
        <div className="beauty-mark">B</div>
        <span><strong>COSTABOTS</strong><small>BEAUTY</small></span>
      </aside>

      <main className="beauty-main">
        {route === 'today' && <TodayPage appointments={appointments} navigate={navigate} onOpenAppointment={setSelectedAppointmentId} showToast={showToast} />}
        {route === 'agenda' && <AgendaPage appointments={appointments} date={selectedDate} onDateChange={setSelectedDate} onOpenAppointment={setSelectedAppointmentId} staffFilter={staffFilter} setStaffFilter={setStaffFilter} />}
        {route === 'customers' && <CustomersPage onOpenCustomer={setSelectedCustomerId} />}
        {route === 'messages' && <MessagesPage conversations={conversations} onOpenConversation={setSelectedConversationId} />}
        {route === 'more' && <MorePage navigate={navigate} showToast={showToast} />}
        {route === 'automations' && <AutomationsPage rules={automationRules} setRules={setAutomationRules} onBack={() => navigate('more')} />}
      </main>

      <BeautyNavigation active={route === 'automations' ? 'more' : route} onNavigate={navigate} />

      {selectedAppointment && (
        <AppointmentDetail
          appointment={selectedAppointment}
          onClose={() => setSelectedAppointmentId(null)}
          onOpenConversation={() => {
            const conversation = conversations.find((item) => item.customerId === selectedAppointment.customerId);
            setSelectedAppointmentId(null);
            navigate('messages');
            setSelectedConversationId(conversation?.id ?? null);
          }}
          onStatusChange={updateAppointmentStatus}
          showToast={showToast}
        />
      )}
      {selectedCustomer && <CustomerDetail customer={selectedCustomer} onClose={() => setSelectedCustomerId(null)} onOpenAppointment={setSelectedAppointmentId} />}
      {selectedConversation && (
        <ConversationDetail
          conversation={selectedConversation}
          onClose={() => setSelectedConversationId(null)}
          onStatusChange={(status) => updateConversationStatus(selectedConversation.id, status)}
        />
      )}
      {toast && <div className="beauty-toast"><Check size={17} />{toast}</div>}
    </div>
  );
}

function TodayPage({ appointments, navigate, onOpenAppointment, showToast }: { appointments: Appointment[]; navigate: (route: BeautyRoute) => void; onOpenAppointment: (id: string) => void; showToast: (message: string) => void }) {
  const todayAppointments = appointments.filter((appointment) => appointment.date === demoToday);
  const activeAppointments = todayAppointments.filter((appointment) => appointment.status !== 'cancelled');
  const nextAppointment = activeAppointments.find((appointment) => ['pending', 'confirmed'].includes(appointment.status)) ?? activeAppointments[0];

  return (
    <div className="beauty-page">
      <header className="today-header">
        <div>
          <p>Buenos días, {business.ownerName}</p>
          <h1>{business.name}</h1>
          <span className="today-date">Martes, 28 de julio</span>
        </div>
        <button aria-label="Abrir perfil" className="profile-button" onClick={() => navigate('more')} type="button"><Avatar name={business.ownerName} size="lg" /></button>
      </header>

      <button className="assistant-state" onClick={() => navigate('messages')} type="button">
        <span className="assistant-state__icon"><WandSparkles size={20} /></span>
        <span><strong>Recepcionista IA activa</strong><small>Respondiendo y organizando citas</small></span>
        <span className="live-dot">En línea</span>
      </button>

      <section>
        <Kicker>Resumen de hoy</Kicker>
        <div className="metrics-grid">
          <MetricCard icon={<CalendarDays size={19} />} label="Citas" value={activeAppointments.length} />
          <MetricCard icon={<ShieldCheck size={19} />} label="Confirmadas" tone="sage" value={todayAppointments.filter((item) => item.status === 'confirmed').length} />
          <MetricCard icon={<Clock3 size={19} />} label="Huecos" tone="sand" value="4" />
          <MetricCard icon={<MessageCircle size={19} />} label="Pendientes" tone="lilac" value="3" />
        </div>
      </section>

      {nextAppointment && (
        <section>
          <div className="section-heading"><Kicker>Próxima cita</Kicker><button onClick={() => navigate('agenda')} type="button">Ver agenda</button></div>
          <article className="next-appointment">
            <div className="next-appointment__time"><small>Próxima</small><strong>{nextAppointment.start}</strong><span>{nextAppointment.end}</span></div>
            <div className="next-appointment__content">
              <StatusBadge status={nextAppointment.status} />
              <h2>{findCustomer(nextAppointment.customerId).name}</h2>
              <p>{findService(nextAppointment.serviceId).name}</p>
              <span>con {findStaff(nextAppointment.staffId).name}</span>
            </div>
            <button aria-label="Abrir próxima cita" className="round-arrow" onClick={() => onOpenAppointment(nextAppointment.id)} type="button"><ChevronRight size={22} /></button>
          </article>
        </section>
      )}

      <section>
        <div className="section-heading"><Kicker>Agenda del día</Kicker><span>{activeAppointments.length} citas</span></div>
        <div className="appointment-list">
          {todayAppointments.slice(0, 5).map((appointment) => (
            <AppointmentCard appointment={appointment} customer={findCustomer(appointment.customerId)} key={appointment.id} onOpen={() => onOpenAppointment(appointment.id)} service={findService(appointment.serviceId)} staffMember={findStaff(appointment.staffId)} />
          ))}
        </div>
      </section>

      <section>
        <Kicker>Acciones rápidas</Kicker>
        <div className="quick-actions">
          <button onClick={() => showToast('Formulario de nueva cita preparado para la siguiente iteración')} type="button"><CirclePlus /><span>Nueva cita</span></button>
          <button onClick={() => showToast('Bloqueo horario creado como simulación')} type="button"><LockKeyhole /><span>Bloquear horario</span></button>
          <button onClick={() => navigate('messages')} type="button"><MessageCircle /><span>Abrir mensajes</span></button>
          <button onClick={() => navigate('agenda')} type="button"><CalendarClock /><span>Agenda completa</span></button>
        </div>
      </section>
    </div>
  );
}

function AgendaPage({ appointments, date, onDateChange, onOpenAppointment, staffFilter, setStaffFilter }: { appointments: Appointment[]; date: string; onDateChange: (date: string) => void; onOpenAppointment: (id: string) => void; staffFilter: string; setStaffFilter: (id: string) => void }) {
  const index = dates.indexOf(date);
  const visibleAppointments = appointments
    .filter((appointment) => appointment.date === date && (staffFilter === 'all' || appointment.staffId === staffFilter))
    .sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="beauty-page">
      <PageHeader eyebrow="Organiza tu día" title="Agenda" action={<button className="primary-icon-button" onClick={() => onDateChange(demoToday)} type="button">Hoy</button>} />
      <div className="date-switcher">
        <button aria-label="Día anterior" disabled={index <= 0} onClick={() => onDateChange(dates[index - 1])} type="button"><ChevronLeft /></button>
        <span><small>Vista diaria</small><strong>{dateLabels[date]}</strong></span>
        <button aria-label="Día siguiente" disabled={index >= dates.length - 1} onClick={() => onDateChange(dates[index + 1])} type="button"><ChevronRight /></button>
      </div>
      <div className="staff-filters" role="group" aria-label="Filtrar por profesional">
        <button className={staffFilter === 'all' ? 'is-active' : ''} onClick={() => setStaffFilter('all')} type="button"><UsersRound size={17} />Todos</button>
        {staff.map((member) => <button className={staffFilter === member.id ? 'is-active' : ''} key={member.id} onClick={() => setStaffFilter(member.id)} type="button"><Avatar accent={member.accent} name={member.name} size="sm" />{member.name}</button>)}
      </div>
      <div className="agenda-summary"><span><strong>{visibleAppointments.length}</strong> citas</span><span><strong>3 h</strong> disponibles</span></div>
      <div className="agenda-timeline">
        {visibleAppointments.length ? visibleAppointments.map((appointment, appointmentIndex) => (
          <div key={appointment.id}>
            <AppointmentCard appointment={appointment} customer={findCustomer(appointment.customerId)} onOpen={() => onOpenAppointment(appointment.id)} service={findService(appointment.serviceId)} staffMember={findStaff(appointment.staffId)} />
            {appointmentIndex === 1 && date === demoToday && <EmptySlot end="12:00" staffName={staffFilter === 'all' ? undefined : findStaff(staffFilter).name} start="11:35" />}
          </div>
        )) : <div className="empty-state"><CalendarDays /><h2>Un día tranquilo</h2><p>No hay citas para este filtro.</p></div>}
        {timeBlocks.filter((block) => block.date === date && (staffFilter === 'all' || block.staffId === staffFilter)).map((block) => <div className="time-block" key={block.id}><LockKeyhole size={17} /><span><strong>{block.start}–{block.end}</strong>{block.reason} · {findStaff(block.staffId).name}</span></div>)}
      </div>
    </div>
  );
}

function CustomersPage({ onOpenCustomer }: { onOpenCustomer: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const filteredCustomers = customers.filter((customer) => customer.name.toLowerCase().includes(query.toLowerCase()) || customer.maskedPhone.includes(query));
  return (
    <div className="beauty-page">
      <PageHeader eyebrow="Conoce a quienes vuelven" title="Clientes" action={<button aria-label="Nuevo cliente" className="primary-circle-button" type="button"><CirclePlus /></button>} />
      <label className="beauty-search"><Search size={19} /><input onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o teléfono" value={query} /></label>
      <div className="customer-list">
        {filteredCustomers.map((customer) => (
          <button className="customer-row" key={customer.id} onClick={() => onOpenCustomer(customer.id)} type="button">
            <CustomerIdentity customer={customer} />
            <span className="customer-row__detail"><small>Última visita</small><strong>{customer.lastVisit}</strong><small>{customer.nextAppointmentId ? 'Próxima cita reservada' : `Sugerencia: ${customer.recommendedService}`}</small></span>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
    </div>
  );
}

const conversationLabels: Record<ConversationStatus, string> = {
  ai_handled: 'Atendida por IA',
  waiting_customer: 'Esperando cliente',
  needs_human: 'Requiere intervención',
  human_handled: 'Atendida por persona',
  closed: 'Finalizada',
};

function MessagesPage({ conversations, onOpenConversation }: { conversations: Conversation[]; onOpenConversation: (id: string) => void }) {
  const urgent = conversations.filter((conversation) => conversation.status === 'needs_human').length;
  return (
    <div className="beauty-page">
      <PageHeader eyebrow="WhatsApp inteligente" title="Mensajes" action={<span className="online-pill"><span />IA en línea</span>} />
      {urgent > 0 && <div className="attention-banner"><BellRing size={20} /><span><strong>{urgent} conversación necesita atención</strong><small>La IA ha detectado que debe intervenir una persona.</small></span></div>}
      <div className="message-tabs"><button className="is-active" type="button">Todas</button><button type="button">Pendientes</button><button type="button">Atendidas</button></div>
      <div className="conversation-list">
        {conversations.map((conversation) => {
          const customer = findCustomer(conversation.customerId);
          return (
            <button className={`conversation-row ${conversation.status === 'needs_human' ? 'conversation-row--urgent' : ''}`} key={conversation.id} onClick={() => onOpenConversation(conversation.id)} type="button">
              <Avatar accent={conversation.status === 'needs_human' ? 'coral' : 'sage'} name={customer.name} />
              <span className="conversation-row__content"><span><strong>{customer.name}</strong><time>{conversation.time}</time></span><p>{conversation.lastMessage}</p><small className={`conversation-state conversation-state--${conversation.status}`}>{conversationLabels[conversation.status]}</small>{conversation.interventionReason && <em>{conversation.interventionReason}</em>}</span>
              {conversation.unread > 0 && <span className="unread-count">{conversation.unread}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MorePage({ navigate, showToast }: { navigate: (route: BeautyRoute) => void; showToast: (message: string) => void }) {
  const items = [
    { icon: Sparkles, label: 'Servicios', detail: '8 servicios configurados' },
    { icon: UsersRound, label: 'Profesionales', detail: '3 profesionales activos' },
    { icon: Clock3, label: 'Horarios', detail: 'Horario y ausencias' },
    { icon: WandSparkles, label: 'Automatizaciones', detail: 'Recordatorios y reactivación', route: 'automations' as BeautyRoute },
    { icon: Settings2, label: 'Configuración', detail: 'Preferencias de la aplicación' },
    { icon: UserRound, label: 'Perfil del negocio', detail: business.name },
  ];
  return (
    <div className="beauty-page">
      <PageHeader eyebrow="Tu espacio de trabajo" title="Más" />
      <section className="business-card"><div className="beauty-mark beauty-mark--large">B</div><span><strong>{business.name}</strong><small>COSTABOTS Beauty · Demo local</small></span><ShieldCheck size={20} /></section>
      <div className="more-list">
        {items.map(({ icon: Icon, label, detail, route }) => <button key={label} onClick={() => route ? navigate(route) : showToast(`${label}: sección prevista para una próxima fase`)} type="button"><span className="more-list__icon"><Icon size={21} /></span><span><strong>{label}</strong><small>{detail}</small></span><ChevronRight /></button>)}
      </div>
      <div className="isolation-note"><ShieldCheck size={20} /><span><strong>Modo prototipo seguro</strong><small>Datos locales · Sin conexiones externas</small></span></div>
    </div>
  );
}

function AutomationsPage({ rules, setRules, onBack }: { rules: typeof initialAutomationRules; setRules: React.Dispatch<React.SetStateAction<typeof initialAutomationRules>>; onBack: () => void }) {
  function toggleRule(id: string) {
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule));
  }
  const metrics = [{ value: 38, label: 'Confirmadas' }, { value: 7, label: 'Canceladas a tiempo' }, { value: 12, label: 'Clientes recuperados' }, { value: 9, label: 'Nuevas reservas' }];
  return (
    <div className="beauty-page">
      <PageHeader eyebrow="Trabajan mientras tú atiendes" title="Automatizaciones" action={<button aria-label="Volver" className="icon-button-soft" onClick={onBack} type="button"><ArrowLeft /></button>} />
      <div className="automation-hero"><WandSparkles /><span><strong>Tu recepcionista no se olvida de nadie</strong><small>Reglas simuladas para validar la experiencia.</small></span></div>
      <section><Kicker>Impacto este mes</Kicker><div className="automation-metrics">{metrics.map((metric) => <article key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}</div></section>
      <AutomationGroup rules={rules.filter((rule) => rule.type === 'appointment')} title="Recordatorios de cita" toggleRule={toggleRule} />
      <AutomationGroup rules={rules.filter((rule) => rule.type === 'reactivation')} title="Reactivación de clientes" toggleRule={toggleRule} />
    </div>
  );
}

function AutomationGroup({ rules, title, toggleRule }: { rules: typeof initialAutomationRules; title: string; toggleRule: (id: string) => void }) {
  return <section><Kicker>{title}</Kicker><div className="automation-list">{rules.map((rule) => <article key={rule.id}><span><strong>{rule.name}</strong><small>{rule.daysAfter ? `${rule.daysAfter} días · ` : ''}{rule.description}</small></span><button aria-label={`${rule.enabled ? 'Desactivar' : 'Activar'} ${rule.name}`} aria-pressed={rule.enabled} className={`beauty-toggle ${rule.enabled ? 'is-on' : ''}`} onClick={() => toggleRule(rule.id)} type="button"><span /></button></article>)}</div></section>;
}

function AppointmentDetail({ appointment, onClose, onOpenConversation, onStatusChange, showToast }: { appointment: Appointment; onClose: () => void; onOpenConversation: () => void; onStatusChange: (status: AppointmentStatus) => void; showToast: (message: string) => void }) {
  const customer = findCustomer(appointment.customerId);
  const service = findService(appointment.serviceId);
  const member = findStaff(appointment.staffId);
  return (
    <Sheet onClose={onClose} subtitle={`${dateLabels[appointment.date] ?? appointment.date} · ${appointment.start}`} title={service.name} wide>
      <div className="appointment-detail-hero"><CustomerIdentity customer={customer} large /><StatusBadge status={appointment.status} /></div>
      <div className="detail-grid">
        <DetailRow icon={<UserRound size={18} />} label="Profesional" value={member.name} />
        <DetailRow icon={<Clock3 size={18} />} label="Horario" value={`${appointment.start}–${appointment.end} · ${service.durationMinutes} min`} />
        <DetailRow icon={<Sparkles size={18} />} label="Precio orientativo" value={`${service.price} €`} />
        <DetailRow icon={<MessageCircle size={18} />} label="Origen" value={appointment.source} />
        <DetailRow icon={<Phone size={18} />} label="Teléfono" value={customer.maskedPhone} />
      </div>
      {appointment.notes && <div className="detail-note"><strong>Notas</strong><p>{appointment.notes}</p></div>}
      {appointment.hasReferencePhoto && <div className="reference-photo"><Image size={24} /><span><strong>Fotografía de referencia</strong><small>Vista simulada, sin archivo real</small></span></div>}
      <section><Kicker>Historial</Kicker><div className="history-list">{appointment.history.map((item) => <div key={item.id}><span /><p><strong>{item.label}</strong><small>{item.at}</small></p></div>)}</div></section>
      <section><Kicker>Acciones</Kicker><div className="detail-actions">
        <button onClick={() => onStatusChange('confirmed')} type="button">Confirmar</button>
        <button onClick={() => onStatusChange('arrived')} type="button">Marcar llegada</button>
        <button onClick={() => onStatusChange('in_service')} type="button">Iniciar servicio</button>
        <button onClick={() => onStatusChange('completed')} type="button">Finalizar</button>
        <button onClick={() => showToast('Cambio de hora simulado')} type="button">Cambiar hora</button>
        <button className="danger-action" onClick={() => onStatusChange('cancelled')} type="button">Cancelar</button>
        <button onClick={onOpenConversation} type="button">Abrir conversación</button>
        <button onClick={() => showToast('Llamada deshabilitada en el prototipo')} type="button">Llamar</button>
      </div></section>
    </Sheet>
  );
}

function CustomerDetail({ customer, onClose, onOpenAppointment }: { customer: Customer; onClose: () => void; onOpenAppointment: (id: string) => void }) {
  const customerAppointments = initialAppointments.filter((appointment) => appointment.customerId === customer.id);
  return (
    <Sheet onClose={onClose} subtitle="Ficha de cliente" title={customer.name}>
      <CustomerIdentity customer={customer} large />
      <div className="detail-grid detail-grid--single">
        <DetailRow icon={<Phone size={18} />} label="Contacto" value={customer.maskedPhone} />
        <DetailRow icon={<Sparkles size={18} />} label="Servicios habituales" value={customer.usualServices.join(', ')} />
        <DetailRow icon={<UserRound size={18} />} label="Profesional preferido" value={customer.preferredStaffId ? findStaff(customer.preferredStaffId).name : 'Sin preferencia'} />
        <DetailRow icon={<BellRing size={18} />} label="Próxima reactivación" value={customer.nextReactivation} />
        <DetailRow icon={<ShieldCheck size={18} />} label="Consentimiento mensajes" value={customer.messagingConsent ? 'Aceptado' : 'No aceptado'} />
      </div>
      <div className="detail-note"><strong>Notas</strong><p>{customer.notes || 'Sin notas.'}</p></div>
      <section><Kicker>Historial de citas</Kicker><div className="mini-appointment-list">{customerAppointments.map((appointment) => <button key={appointment.id} onClick={() => { onClose(); onOpenAppointment(appointment.id); }} type="button"><span><strong>{findService(appointment.serviceId).name}</strong><small>{dateLabels[appointment.date] ?? appointment.date} · {appointment.start}</small></span><StatusBadge status={appointment.status} /></button>)}</div></section>
    </Sheet>
  );
}

function ConversationDetail({ conversation, onClose, onStatusChange }: { conversation: Conversation; onClose: () => void; onStatusChange: (status: ConversationStatus) => void }) {
  const customer = findCustomer(conversation.customerId);
  return (
    <Sheet onClose={onClose} subtitle={conversationLabels[conversation.status]} title={customer.name}>
      {conversation.interventionReason && <div className="attention-banner attention-banner--compact"><BellRing size={18} /><span><strong>Necesita intervención</strong><small>{conversation.interventionReason}</small></span></div>}
      <div className="chat-window">
        <div className="chat-day">Hoy</div>
        {conversation.messages.map((message) => <div className={`chat-bubble chat-bubble--${message.sender}`} key={message.id}><p>{message.text}</p><span>{message.sender === 'ai' ? 'IA · ' : message.sender === 'human' ? 'Equipo · ' : ''}{message.time}</span></div>)}
      </div>
      <div className="chat-composer"><input aria-label="Mensaje simulado" disabled placeholder="Escribe un mensaje…" /><button disabled type="button"><MessageCircle size={19} /></button></div>
      <div className="conversation-actions">
        {conversation.status !== 'human_handled' && <button onClick={() => onStatusChange('human_handled')} type="button"><UserRound size={18} />Tomar conversación</button>}
        {conversation.status === 'human_handled' && <button onClick={() => onStatusChange('ai_handled')} type="button"><WandSparkles size={18} />Devolver a la IA</button>}
      </div>
    </Sheet>
  );
}
