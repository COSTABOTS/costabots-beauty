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
  LogOut,
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
import { useEffect, useState } from 'react';
import { beautyEnvironment } from '../../config/environment';
import { useAuth } from '../auth/hooks/AuthProvider';
import { signOut } from '../auth/services/authService';
import { useBeautyBusiness } from './context/BeautyBusinessProvider';
import { BeautyDataProvider, beautyDataRange, useBeautyData } from './context/BeautyDataProvider';
import {
  automationRules as initialAutomationRules,
  business,
  conversations as initialConversations,
  customers as mockCustomers,
  demoToday,
} from './mock/data';
import type { Appointment, AppointmentStatus, BeautyRoute, Conversation, ConversationStatus, Customer } from './types';
import {
  AppointmentCard,
  Avatar,
  BeautyNavigation,
  CustomerIdentity,
  DetailRow,
  EmptySlot,
  FeatureStateBadge,
  MetricCard,
  PageHeader,
  Sheet,
  StatusBadge,
} from './components/ui';
import { BeautyBrandLockup, BeautyBrandMark } from './components/BeautyBrand';
import { CustomerForm } from './components/CustomerForm';
import { SchedulesManagementPage, ServicesManagementPage, StaffManagementPage } from './components/BusinessSetup';
import './beauty.css';

const dates = ['2026-07-27', demoToday, '2026-07-29', '2026-07-30'];
const dateLabels: Record<string, string> = {
  '2026-07-27': 'Lunes, 27 de julio',
  [demoToday]: 'Martes, 28 de julio',
  '2026-07-29': 'Miércoles, 29 de julio',
  '2026-07-30': 'Jueves, 30 de julio',
};

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function dateLabel(date: string, timezone = 'Europe/Madrid') {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00Z`));
}

function currentDateInTimezone(timezone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const incompleteCustomer: Customer = { id: 'incomplete', name: 'Cliente no disponible', phone: '', maskedPhone: 'Sin teléfono', lastVisit: 'Sin datos', recommendedService: 'Sin datos', recurrent: false, notes: '', messagingConsent: false, nextReactivation: 'Sin datos', usualServices: ['Sin datos'] };
const incompleteService: import('./types').BeautyService = { id: 'incomplete', name: 'Servicio no disponible', durationMinutes: 0, price: 0, category: 'hair' };
const incompleteStaff: import('./types').StaffMember = { id: 'incomplete', name: 'Profesional no disponible', role: 'Sin datos', initials: '—', accent: 'sand' };

function findCustomer(customers: Customer[], id: string) {
  return customers.find((customer) => customer.id === id) ?? incompleteCustomer;
}

function findService(services: import('./types').BeautyService[], id: string) {
  return services.find((service) => service.id === id) ?? incompleteService;
}

function findStaff(staff: import('./types').StaffMember[], id: string) {
  return staff.find((member) => member.id === id) ?? incompleteStaff;
}

function Kicker({ children }: { children: string }) {
  return <p className="section-kicker">{children}</p>;
}

export function BeautyApp() {
  return <BeautyDataProvider><BeautyDataGate /></BeautyDataProvider>;
}

function BeautyDataGate() {
  const beautyData = useBeautyData();
  if (beautyData.status === 'loading') {
    return <div className="beauty-data-state" role="status"><BeautyBrandMark size="lg" /><span className="beauty-data-spinner" /><h1>Cargando tu negocio…</h1><p>Estamos preparando agenda, clientes y equipo.</p></div>;
  }
  if (beautyData.status === 'error') {
    return <div className="beauty-data-state" role="alert"><ShieldCheck size={32} /><h1>No podemos cargar los datos</h1><p>{beautyData.message}</p><button onClick={beautyData.retry} type="button">Volver a intentar</button></div>;
  }
  return <BeautyManager />;
}

function BeautyManager() {
  void beautyEnvironment.productId;
  const auth = useAuth();
  const membership = useBeautyBusiness();
  const beautyData = useBeautyData();
  if (beautyData.status !== 'ready') return null;
  const { appointments: loadedAppointments, customers, services, staff, timeBlocks } = beautyData.data;
  const businessName = membership.business.name;
  const mode = beautyData.mode;
  const operationalToday = mode === 'mock' ? demoToday : currentDateInTimezone(beautyData.data.business.timezone);
  const ownerDisplayName = auth.user?.user_metadata?.full_name
    ?? auth.user?.user_metadata?.name
    ?? auth.user?.email?.split('@')[0]
    ?? business.ownerName;
  const [route, setRoute] = useState<BeautyRoute>('today');
  const [appointments, setAppointments] = useState(loadedAppointments);
  const [conversations, setConversations] = useState(initialConversations);
  const [automationRules, setAutomationRules] = useState(initialAutomationRules);
  const [selectedDate, setSelectedDate] = useState(operationalToday);
  const [staffFilter, setStaffFilter] = useState('all');
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [appointmentCustomerId, setAppointmentCustomerId] = useState<string | null>(null);
  const [extraAppointmentServices, setExtraAppointmentServices] = useState<import('./data/types').AppointmentService[]>([]);
  const [setupStaffId, setSetupStaffId] = useState<string | undefined>();
  const [toast, setToast] = useState('');
  const [activeForm, setActiveForm] = useState<'appointment' | 'block' | 'customer' | 'edit-customer' | null>(null);
  const canManageCustomers = membership.role === 'owner' || membership.role === 'admin';

  useEffect(() => {
    setAppointments(loadedAppointments);
  }, [loadedAppointments]);

  const selectedAppointment = appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null;
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;

  useEffect(() => {
    if (selectedAppointmentId) void beautyData.loadAppointmentHistory(selectedAppointmentId);
  }, [beautyData.loadAppointmentHistory, selectedAppointmentId]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2300);
  }

  function navigate(nextRoute: BeautyRoute) {
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function updateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
    await beautyData.updateAppointmentStatus({ appointmentId, status: status as import('./data/types').WritableAppointmentStatus });
    showToast(beautyData.mode === 'supabase' ? 'Estado guardado' : 'Estado actualizado en la demo');
  }

  function updateConversationStatus(id: string, status: ConversationStatus) {
    setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, status, unread: 0 } : conversation));
    showToast(status === 'human_handled' ? 'Ahora atiendes esta conversación' : 'La conversación vuelve a la IA');
  }

  return (
    <div className="beauty-app">
      <aside className="desktop-brand">
        <BeautyBrandLockup />
      </aside>

      <main className="beauty-main">
        {mode === 'mock' && <div className="mode-notice"><FeatureStateBadge state="demo" /><span>Los datos y acciones simuladas no se guardan fuera de esta demostración.</span></div>}
        {route === 'today' && <TodayPage appointments={appointments} businessName={businessName} customers={customers} mode={mode} navigate={navigate} onCreateAppointment={() => setActiveForm('appointment')} onCreateBlock={() => setActiveForm('block')} onOpenAppointment={setSelectedAppointmentId} onStatusChange={updateAppointmentStatus} ownerDisplayName={ownerDisplayName} services={services} staff={staff} today={operationalToday} timezone={beautyData.data.business.timezone} />}
        {route === 'agenda' && <AgendaPage appointments={appointments} customers={customers} date={selectedDate} mode={mode} onCreateAppointment={() => setActiveForm('appointment')} onDateChange={setSelectedDate} onOpenAppointment={setSelectedAppointmentId} onStatusChange={updateAppointmentStatus} services={services} staff={staff} staffFilter={staffFilter} setStaffFilter={setStaffFilter} timeBlocks={timeBlocks} timezone={beautyData.data.business.timezone} today={operationalToday} />}
        {route === 'customers' && <CustomersPage canManage={canManageCustomers} customers={customers} mode={mode} onCreateCustomer={() => setActiveForm('customer')} onOpenCustomer={setSelectedCustomerId} />}
        {route === 'messages' && <MessagesPage conversations={conversations} mode={mode} onOpenConversation={setSelectedConversationId} />}
        {route === 'more' && <MorePage businessName={businessName} mode={mode} navigate={navigate} onSignOut={() => void signOut()} serviceCount={services.length} staffCount={staff.length} />}
        {route === 'automations' && <AutomationsPage mode={mode} rules={automationRules} setRules={setAutomationRules} onBack={() => navigate('more')} />}
        {route === 'staff' && <StaffManagementPage appointments={appointments} canManage={canManageCustomers} mode={mode} onBack={() => navigate('more')} onCreate={beautyData.createStaff} onDeactivate={(staffId) => beautyData.deactivateStaff({ staffId })} onOpenSchedules={(staffId) => { setSetupStaffId(staffId); navigate('schedules'); }} onSetAssignment={beautyData.setStaffService} onUpdate={beautyData.updateStaff} services={services} staff={staff} staffServices={beautyData.data.staffServices} />}
        {route === 'services' && <ServicesManagementPage canManage={canManageCustomers} mode={mode} onBack={() => navigate('more')} onCreate={beautyData.createService} onDeactivate={(serviceId) => beautyData.deactivateService({ serviceId })} onUpdate={beautyData.updateService} services={services} staffServices={beautyData.data.staffServices} />}
        {route === 'schedules' && <SchedulesManagementPage initialStaffId={setupStaffId} mode={mode} onBack={() => navigate('more')} onCreateAbsence={(staffId) => { setSetupStaffId(staffId); setActiveForm('block'); }} onSave={(staffId, segments) => beautyData.replaceWeeklySchedule({ staffId, segments })} schedules={beautyData.data.schedules} staff={staff} />}
      </main>

      <BeautyNavigation active={['automations', 'staff', 'services', 'schedules'].includes(route) ? 'more' : route} onNavigate={navigate} />

      {selectedAppointment && (
        <AppointmentDetail
          appointment={selectedAppointment}
          appointmentServices={[...beautyData.data.appointmentServices, ...extraAppointmentServices]}
          customers={customers}
          readOnly={beautyData.mode === 'supabase'}
          services={services}
          staff={staff}
          onClose={() => setSelectedAppointmentId(null)}
          onOpenConversation={() => {
            const conversation = conversations.find((item) => item.customerId === selectedAppointment.customerId);
            setSelectedAppointmentId(null);
            navigate('messages');
            setSelectedConversationId(conversation?.id ?? null);
          }}
          onStatusChange={(status) => updateAppointmentStatus(selectedAppointment.id, status)}
          showToast={showToast}
        />
      )}
      {selectedCustomer && <CustomerDetail canManage={canManageCustomers} customer={selectedCustomer} getHistory={beautyData.getCustomerHistory} mode={mode} onClose={() => setSelectedCustomerId(null)} onCreateAppointment={() => { setAppointmentCustomerId(selectedCustomer.id); setSelectedCustomerId(null); setActiveForm('appointment'); }} onDeactivate={async () => { await beautyData.deactivateCustomer({ customerId: selectedCustomer.id }); showToast(mode === 'mock' ? 'Cliente desactivado en la demo' : 'Cliente desactivado'); }} onEdit={() => setActiveForm('edit-customer')} onOpenAppointment={(appointment, linkedServices) => { setAppointments((current) => current.some((item) => item.id === appointment.id) ? current : [...current, appointment]); setExtraAppointmentServices((current) => [...current.filter((item) => item.appointmentId !== appointment.id), ...linkedServices]); setSelectedCustomerId(null); setSelectedAppointmentId(appointment.id); }} services={services} staff={staff} today={operationalToday} />}
      {selectedConversation && (
        <ConversationDetail
          conversation={selectedConversation}
          onClose={() => setSelectedConversationId(null)}
          onStatusChange={(status) => updateConversationStatus(selectedConversation.id, status)}
        />
      )}
      {activeForm === 'block' && <TimeBlockForm defaultDate={selectedDate} initialStaffId={setupStaffId} maxDate={addDays(beautyDataRange.to, -1)} minDate={beautyDataRange.from} onClose={() => setActiveForm(null)} onCreate={async (command) => { await beautyData.createTimeBlock(command); setActiveForm(null); showToast(beautyData.mode === 'supabase' ? 'Bloqueo guardado' : 'Bloqueo creado en la demo'); }} staff={staff.filter((item) => item.active !== false)} />}
      {activeForm === 'appointment' && <NewAppointmentForm customers={customers.filter((customer) => customer.active !== false)} defaultDate={selectedDate} initialCustomerId={appointmentCustomerId} maxDate={addDays(beautyDataRange.to, -1)} minDate={beautyDataRange.from} onClose={() => { setActiveForm(null); setAppointmentCustomerId(null); }} onCreate={async (command) => { const id = await beautyData.createAppointment(command); setActiveForm(null); setAppointmentCustomerId(null); setSelectedAppointmentId(id); showToast(beautyData.mode === 'supabase' ? 'Cita creada' : 'Cita creada en la demo'); }} onGetAvailability={beautyData.getAvailability} services={services.filter((item) => item.active !== false)} staff={staff.filter((item) => item.active !== false)} staffServices={beautyData.data.staffServices.filter((item) => item.active)} timezone={beautyData.data.business.timezone} />}
      {activeForm === 'customer' && <CustomerForm mode={mode} onClose={() => setActiveForm(null)} onSave={async (value) => { const id = await beautyData.createCustomer(value); setActiveForm(null); setSelectedCustomerId(id); showToast(mode === 'mock' ? 'Cliente creado en la demo' : 'Cliente creado'); }} staff={staff} />}
      {activeForm === 'edit-customer' && selectedCustomer && <CustomerForm customer={selectedCustomer} mode={mode} onClose={() => setActiveForm(null)} onSave={async (value) => { await beautyData.updateCustomer({ ...value, customerId: selectedCustomer.id }); setActiveForm(null); showToast(mode === 'mock' ? 'Cliente actualizado en la demo' : 'Cliente actualizado'); }} staff={staff} />}
      {toast && <div className="beauty-toast"><Check size={17} />{toast}</div>}
    </div>
  );
}

function TodayPage({ appointments, businessName, customers, mode, navigate, onCreateAppointment, onCreateBlock, onOpenAppointment, onStatusChange, ownerDisplayName, services, staff, today, timezone }: { appointments: Appointment[]; businessName: string; customers: Customer[]; mode: 'mock' | 'supabase'; navigate: (route: BeautyRoute) => void; onCreateAppointment: () => void; onCreateBlock: () => void; onOpenAppointment: (id: string) => void; onStatusChange: (appointmentId: string, status: AppointmentStatus) => Promise<void>; ownerDisplayName: string; services: import('./types').BeautyService[]; staff: import('./types').StaffMember[]; today: string; timezone: string }) {
  const todayAppointments = appointments.filter((appointment) => appointment.date === today);
  const activeAppointments = todayAppointments.filter((appointment) => appointment.status !== 'cancelled');
  const nextAppointment = activeAppointments.find((appointment) => ['pending', 'confirmed'].includes(appointment.status)) ?? activeAppointments[0];

  return (
    <div className="beauty-page">
      <header className="today-header">
        <div>
          <p>Buenos días, {ownerDisplayName}</p>
          <h1>{businessName}</h1>
          <span className="today-date">{dateLabel(today, timezone)}</span>
        </div>
        <button aria-label="Abrir perfil y configuración" className="profile-button profile-button--brand" onClick={() => navigate('more')} type="button"><BeautyBrandMark size="sm" /></button>
      </header>

      <button className={`assistant-state ${mode === 'supabase' ? 'assistant-state--inactive' : ''}`} onClick={() => navigate('messages')} type="button">
        <span className="assistant-state__icon"><WandSparkles size={20} /></span>
        <span><strong>{mode === 'mock' ? 'Recepcionista IA · Demostración' : 'Recepcionista IA no conectada'}</strong><small>{mode === 'mock' ? 'Flujo conceptual con datos simulados' : 'La conexión con WhatsApp e IA estará disponible próximamente'}</small></span>
        <FeatureStateBadge state={mode === 'mock' ? 'demo' : 'soon'} />
      </button>

      <section>
        <Kicker>Resumen de hoy</Kicker>
        <div className={`metrics-grid ${mode === 'supabase' ? 'metrics-grid--real' : ''}`}>
          <MetricCard icon={<CalendarDays size={19} />} label="Citas" value={activeAppointments.length} />
          <MetricCard icon={<ShieldCheck size={19} />} label="Confirmadas" tone="sage" value={todayAppointments.filter((item) => item.status === 'confirmed').length} />
          {mode === 'mock' && <MetricCard icon={<Clock3 size={19} />} label="Huecos · Demo" tone="sand" value="4" />}
          {mode === 'mock' && <MetricCard icon={<MessageCircle size={19} />} label="Pendientes · Demo" tone="lilac" value="3" />}
        </div>
      </section>

      {nextAppointment && (
        <section>
          <div className="section-heading"><Kicker>Próxima cita</Kicker><button onClick={() => navigate('agenda')} type="button">Ver agenda</button></div>
          <article className="next-appointment">
            <div className="next-appointment__time"><small>Próxima</small><strong>{nextAppointment.start}</strong><span>{nextAppointment.end}</span></div>
            <div className="next-appointment__content">
              <StatusBadge status={nextAppointment.status} />
              <h2>{findCustomer(customers, nextAppointment.customerId).name}</h2>
              <p>{findService(services, nextAppointment.serviceId).name}</p>
              <span>con {findStaff(staff, nextAppointment.staffId).name}</span>
            </div>
            <button aria-label="Abrir próxima cita" className="round-arrow" onClick={() => onOpenAppointment(nextAppointment.id)} type="button"><ChevronRight size={22} /></button>
          </article>
        </section>
      )}

      <section>
        <div className="section-heading"><Kicker>Agenda del día</Kicker><span>{activeAppointments.length} citas</span></div>
        {todayAppointments.length ? <div className="appointment-list">
          {todayAppointments.slice(0, 5).map((appointment) => (
            <AppointmentCard appointment={appointment} customer={findCustomer(customers, appointment.customerId)} key={appointment.id} onOpen={() => onOpenAppointment(appointment.id)} onStatusChange={onStatusChange} service={findService(services, appointment.serviceId)} staffMember={findStaff(staff, appointment.staffId)} />
          ))}
        </div> : <div className="empty-state empty-state--compact"><CalendarDays /><h2>Hoy no hay citas</h2><p>La agenda está libre para este día.</p></div>}
      </section>

      <section>
        <Kicker>Acciones rápidas</Kicker>
        <div className="quick-actions">
          <button onClick={onCreateAppointment} type="button"><CirclePlus /><span>Nueva cita</span></button>
          <button onClick={onCreateBlock} type="button"><LockKeyhole /><span>Bloquear horario</span></button>
          <button onClick={() => navigate('messages')} type="button"><MessageCircle /><span>Abrir mensajes</span></button>
          <button onClick={() => navigate('agenda')} type="button"><CalendarClock /><span>Agenda completa</span></button>
        </div>
      </section>
    </div>
  );
}

function AgendaPage({ appointments, customers, date, mode, onCreateAppointment, onDateChange, onOpenAppointment, onStatusChange, services, staff, staffFilter, setStaffFilter, timeBlocks, timezone, today }: { appointments: Appointment[]; customers: Customer[]; date: string; mode: 'mock' | 'supabase'; onCreateAppointment: () => void; onDateChange: (date: string) => void; onOpenAppointment: (id: string) => void; onStatusChange: (appointmentId: string, status: AppointmentStatus) => Promise<void>; services: import('./types').BeautyService[]; staff: import('./types').StaffMember[]; staffFilter: string; setStaffFilter: (id: string) => void; timeBlocks: import('./types').TimeBlock[]; timezone: string; today: string }) {
  const index = dates.indexOf(date);
  const lastLoadedDate = addDays(beautyDataRange.to, -1);
  const previousDisabled = mode === 'mock' ? index <= 0 : date <= beautyDataRange.from;
  const nextDisabled = mode === 'mock' ? index >= dates.length - 1 : date >= lastLoadedDate;
  const visibleAppointments = appointments
    .filter((appointment) => appointment.date === date && (staffFilter === 'all' || appointment.staffId === staffFilter))
    .sort((a, b) => a.start.localeCompare(b.start));

  return (
    <div className="beauty-page">
      <PageHeader eyebrow="Organiza tu día" title="Agenda" action={<div className="heading-actions"><button className="primary-icon-button" onClick={() => onDateChange(today)} type="button">Hoy</button><button aria-label="Nueva cita" className="primary-icon-button" onClick={onCreateAppointment} type="button"><CirclePlus size={17} /></button></div>} />
      <div className="date-switcher">
        <button aria-label="Día anterior" disabled={previousDisabled} onClick={() => onDateChange(mode === 'mock' ? dates[index - 1] : addDays(date, -1))} type="button"><ChevronLeft /></button>
        <span><small>Vista diaria</small><strong>{mode === 'mock' ? dateLabels[date] : dateLabel(date, timezone)}</strong></span>
        <button aria-label="Día siguiente" disabled={nextDisabled} onClick={() => onDateChange(mode === 'mock' ? dates[index + 1] : addDays(date, 1))} type="button"><ChevronRight /></button>
      </div>
      <div className="staff-filters" role="group" aria-label="Filtrar por profesional">
        <button className={staffFilter === 'all' ? 'is-active' : ''} onClick={() => setStaffFilter('all')} type="button"><UsersRound size={17} />Todos</button>
        {staff.map((member) => <button className={staffFilter === member.id ? 'is-active' : ''} key={member.id} onClick={() => setStaffFilter(member.id)} type="button"><Avatar accent={member.accent} name={member.name} size="sm" />{member.name}</button>)}
      </div>
      <div className="agenda-summary"><span><strong>{visibleAppointments.length}</strong> citas</span><span>{mode === 'mock' ? <><strong>3 h</strong> disponibles · Demo</> : <>Disponibilidad no calculada</>}</span></div>
      <div className="agenda-timeline">
        {visibleAppointments.length ? visibleAppointments.map((appointment, appointmentIndex) => (
          <div key={appointment.id}>
            <AppointmentCard appointment={appointment} customer={findCustomer(customers, appointment.customerId)} onOpen={() => onOpenAppointment(appointment.id)} onStatusChange={onStatusChange} service={findService(services, appointment.serviceId)} staffMember={findStaff(staff, appointment.staffId)} />
            {mode === 'mock' && appointmentIndex === 1 && date === demoToday && <EmptySlot end="12:00" staffName={staffFilter === 'all' ? undefined : findStaff(staff, staffFilter).name} start="11:35" />}
          </div>
        )) : <div className="empty-state"><CalendarDays /><h2>Un día tranquilo</h2><p>No hay citas para este filtro.</p></div>}
        {timeBlocks.filter((block) => block.date === date && (staffFilter === 'all' || block.staffId === staffFilter || block.staffId === 'all')).map((block) => <div className="time-block" key={block.id}><LockKeyhole size={17} /><span><strong>{block.start}–{block.end}</strong>{block.reason} · {block.staffId === 'all' ? 'Todo el negocio' : findStaff(staff, block.staffId).name}</span></div>)}
      </div>
    </div>
  );
}

function CustomersPage({ canManage, customers, mode, onCreateCustomer, onOpenCustomer }: { canManage: boolean; customers: Customer[]; mode: 'mock' | 'supabase'; onCreateCustomer: () => void; onOpenCustomer: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const normalizedQuery = query.toLocaleLowerCase('es').replace(/\s+/g, '');
  const filteredCustomers = customers.filter((customer) => {
    if (!showInactive && customer.active === false) return false;
    const nameMatches = customer.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'));
    const phoneMatches = customer.phone.replace(/\s+/g, '').includes(normalizedQuery);
    return nameMatches || phoneMatches;
  });
  return (
    <div className="beauty-page">
      <PageHeader eyebrow="Conoce a quienes vuelven" title="Clientes" action={<button aria-label="Nuevo cliente" className="primary-icon-button customer-create-button" disabled={!canManage} onClick={onCreateCustomer} type="button"><CirclePlus size={17} />Nuevo cliente{mode === 'mock' && <FeatureStateBadge state="demo" />}</button>} />
      <label className="beauty-search"><Search size={19} /><input onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre o teléfono" value={query} /></label>
      <label className="inactive-filter"><input checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} type="checkbox" /><span>Mostrar clientes inactivos</span></label>
      <div className="customer-list">
        {filteredCustomers.map((customer) => (
          <button className={`customer-row ${customer.active === false ? 'customer-row--inactive' : ''}`} key={customer.id} onClick={() => onOpenCustomer(customer.id)} type="button">
            <CustomerIdentity customer={customer} />
            <span className="customer-row__detail"><small>{customer.active === false ? 'Cliente inactivo' : 'Última visita'}</small><strong>{customer.active === false ? 'Sin nuevas operaciones' : customer.lastVisit}</strong><small>{customer.nextAppointmentId ? 'Próxima cita reservada' : `Sugerencia: ${customer.recommendedService}`}</small></span>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
      {filteredCustomers.length === 0 && <div className="empty-state"><UsersRound /><h2>Sin clientes</h2><p>No hay clientes que coincidan con la búsqueda.</p></div>}
    </div>
  );
}

function TimeBlockForm({ defaultDate, initialStaffId, maxDate, minDate, onClose, onCreate, staff }: { defaultDate: string; initialStaffId?: string; maxDate: string; minDate: string; onClose: () => void; onCreate: (command: import('./data/types').CreateTimeBlockCommand) => Promise<void>; staff: import('./types').StaffMember[] }) {
  const membership = useBeautyBusiness();
  const canManageAll = membership.role === 'owner' || membership.role === 'admin';
  const [staffId, setStaffId] = useState(initialStaffId ?? (canManageAll ? 'all' : staff[0]?.id ?? ''));
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState('13:00');
  const [end, setEnd] = useState('14:00');
  const [type, setType] = useState<import('./data/types').BeautyTimeBlockType>('break');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || !start || !end || start >= end) {
      setError('La hora de inicio debe ser anterior a la hora de fin.');
      return;
    }
    if (staffId === 'all' && !['business_closed', 'other'].includes(type)) {
      setError('Un bloqueo global debe ser cierre del negocio u otro.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onCreate({ staffId: staffId === 'all' ? null : staffId, date, start, end, type, reason, notes });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hemos podido guardar el bloqueo.');
      setSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} subtitle="Agenda protegida" title="Nuevo bloqueo">
      <form className="beauty-command-form" onSubmit={submit}>
        <label><span>Profesional</span><select onChange={(event) => { const value = event.target.value; setStaffId(value); if (value === 'all' && !['business_closed', 'other'].includes(type)) setType('business_closed'); }} value={staffId}>{canManageAll && <option value="all">Negocio completo</option>}{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
        <div className="form-columns"><label><span>Fecha</span><input max={maxDate} min={minDate} onChange={(event) => setDate(event.target.value)} required type="date" value={date} /></label><label><span>Tipo</span><select onChange={(event) => setType(event.target.value as import('./data/types').BeautyTimeBlockType)} value={type}>{staffId === 'all' ? <><option value="business_closed">Cierre</option><option value="other">Otro</option></> : <><option value="break">Pausa</option><option value="absence">Ausencia</option><option value="vacation">Vacaciones</option><option value="personal">Personal</option><option value="other">Otro</option></>}</select></label></div>
        <div className="form-columns"><label><span>Inicio</span><input onChange={(event) => setStart(event.target.value)} required type="time" value={start} /></label><label><span>Fin</span><input onChange={(event) => setEnd(event.target.value)} required type="time" value={end} /></label></div>
        <label><span>Motivo</span><input maxLength={160} onChange={(event) => setReason(event.target.value)} placeholder="Ej. Formación del equipo" value={reason} /></label>
        <label><span>Notas opcionales</span><textarea maxLength={500} onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="form-submit" disabled={saving} type="submit">{saving ? 'Guardando…' : 'Guardar bloqueo'}</button>
      </form>
    </Sheet>
  );
}

function NewAppointmentForm({ customers, defaultDate, initialCustomerId, maxDate, minDate, onClose, onCreate, onGetAvailability, services, staff, staffServices, timezone }: { customers: Customer[]; defaultDate: string; initialCustomerId: string | null; maxDate: string; minDate: string; onClose: () => void; onCreate: (command: import('./data/types').CreateAppointmentCommand) => Promise<void>; onGetAvailability: (command: import('./data/types').AvailabilityCommand) => Promise<import('./data/types').AvailabilitySlot[]>; services: import('./types').BeautyService[]; staff: import('./types').StaffMember[]; staffServices: import('./data/types').StaffServiceAssignment[]; timezone: string }) {
  const [customerId, setCustomerId] = useState(initialCustomerId ?? customers[0]?.id ?? '');
  const [staffId, setStaffId] = useState(staff[0]?.id ?? '');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [date, setDate] = useState(defaultDate);
  const [slots, setSlots] = useState<import('./data/types').AvailabilitySlot[]>([]);
  const [startsAt, setStartsAt] = useState('');
  const [notes, setNotes] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const assignments = staffServices.filter((item) => item.staffId === staffId && item.active);
  const eligibleServices = services.filter((service) => assignments.some((item) => item.serviceId === service.id));
  const selectedAssignments = serviceIds.map((id) => assignments.find((item) => item.serviceId === id)).filter((item): item is import('./data/types').StaffServiceAssignment => Boolean(item));
  const totalDuration = selectedAssignments.reduce((total, item) => total + item.durationMinutes, 0);
  const totalPrice = selectedAssignments.reduce((total, item) => total + item.price, 0);
  const canSubmit = Boolean(customerId && staffId && serviceIds.length && startsAt);
  const submitHint = !customerId
    ? 'Selecciona un cliente para continuar.'
    : !staffId
      ? 'Selecciona un profesional para continuar.'
      : serviceIds.length === 0
        ? 'Selecciona al menos un servicio.'
        : !startsAt
          ? 'Consulta y selecciona una hora disponible.'
          : '';

  async function findSlots() {
    if (!staffId || !date || serviceIds.length === 0) {
      setError('Selecciona profesional, fecha y al menos un servicio.');
      return;
    }
    setError('');
    setLoadingSlots(true);
    setStartsAt('');
    try {
      setSlots(await onGetAvailability({ serviceId: serviceIds[0], date, staffId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hemos podido consultar la disponibilidad.');
    } finally {
      setLoadingSlots(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerId || !staffId || !serviceIds.length || !startsAt) {
      setError('Completa cliente, profesional, servicios y horario.');
      return;
    }
    if (!window.confirm(`Crear cita por ${totalPrice} € y ${totalDuration} minutos?`)) return;
    setError('');
    setSaving(true);
    try {
      await onCreate({ customerId, staffId, serviceIds, startsAt, customerNotes: notes });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hemos podido crear la cita.');
      setSaving(false);
    }
  }

  const slotLabel = (value: string) => new Intl.DateTimeFormat('es-ES', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  return (
    <Sheet bodyClassName="beauty-sheet__body--appointment" onClose={onClose} subtitle="Disponibilidad real" title="Nueva cita" wide>
      <form className="beauty-command-form appointment-create-form" onSubmit={submit}>
        <div className="appointment-create-form__body">
        <label><span>Cliente</span><select onChange={(event) => setCustomerId(event.target.value)} value={customerId}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
        <div className="form-columns"><label><span>Profesional</span><select onChange={(event) => { setStaffId(event.target.value); setServiceIds([]); setSlots([]); setStartsAt(''); }} value={staffId}>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label><span>Fecha</span><input max={maxDate} min={minDate} onChange={(event) => { setDate(event.target.value); setSlots([]); setStartsAt(''); }} required type="date" value={date} /></label></div>
        <fieldset><legend>Servicios</legend><div className="service-options">{eligibleServices.map((service) => <label key={service.id}><input checked={serviceIds.includes(service.id)} onChange={(event) => { setServiceIds((current) => event.target.checked ? [...current, service.id] : current.filter((id) => id !== service.id)); setSlots([]); setStartsAt(''); }} type="checkbox" /><span><strong>{service.name}</strong><small>{assignments.find((item) => item.serviceId === service.id)?.durationMinutes} min · {assignments.find((item) => item.serviceId === service.id)?.price} €</small></span></label>)}</div></fieldset>
        <div className="appointment-total"><span><small>Duración</small><strong>{totalDuration} min</strong></span><span><small>Total</small><strong>{totalPrice} €</strong></span></div>
        <button className="form-secondary" disabled={loadingSlots} onClick={() => void findSlots()} type="button">{loadingSlots ? 'Consultando…' : 'Consultar horarios'}</button>
        {slots.length > 0 && <fieldset><legend>Hora disponible</legend><div className="slot-options">{slots.map((slot) => <button aria-pressed={startsAt === slot.startsAt} className={startsAt === slot.startsAt ? 'is-selected' : ''} key={slot.startsAt} onClick={() => setStartsAt(slot.startsAt)} type="button">{slotLabel(slot.startsAt)}</button>)}</div></fieldset>}
        {!loadingSlots && serviceIds.length > 0 && slots.length === 0 && <p className="inline-data-message">Consulta la disponibilidad para mostrar horas reales.</p>}
        <label><span>Notas opcionales</span><textarea maxLength={500} onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
        </div>
        <footer className="appointment-create-form__footer">
          {error && <p className="form-error" role="alert">{error}</p>}
          {!canSubmit && !saving && <p className="appointment-create-form__hint">{submitHint}</p>}
          <div>
            <button className="form-cancel" disabled={saving} onClick={onClose} type="button">Cancelar</button>
            <button className="form-submit" disabled={saving || !canSubmit} type="submit">{saving ? 'Creando cita…' : 'Confirmar nueva cita'}</button>
          </div>
        </footer>
      </form>
    </Sheet>
  );
}

const conversationLabels: Record<ConversationStatus, string> = {
  ai_handled: 'Atendida por IA',
  waiting_customer: 'Esperando cliente',
  needs_human: 'Requiere intervención',
  human_handled: 'Atendida por persona',
  closed: 'Finalizada',
};

function MessagesPage({ conversations, mode, onOpenConversation }: { conversations: Conversation[]; mode: 'mock' | 'supabase'; onOpenConversation: (id: string) => void }) {
  const urgent = conversations.filter((conversation) => conversation.status === 'needs_human').length;
  if (mode === 'supabase') {
    return (
      <div className="beauty-page">
        <PageHeader eyebrow="WhatsApp inteligente" title="Mensajes" action={<FeatureStateBadge state="soon" />} />
        <section className="future-panel"><MessageCircle size={26} /><span><strong>Mensajes todavía no conectados</strong><p>La integración segura con WhatsApp, el envío y la atención humana estarán disponibles próximamente.</p></span></section>
        <div className="future-preview" aria-disabled="true">
          <div className="message-tabs"><button className="is-active" disabled type="button">Todas</button><button disabled type="button">Pendientes</button><button disabled type="button">Atendidas</button></div>
          <div className="chat-composer"><input aria-label="Mensajería próximamente" disabled placeholder="Escribe un mensaje…" /><button disabled type="button"><MessageCircle size={19} /></button></div>
        </div>
      </div>
    );
  }
  return (
    <div className="beauty-page">
      <PageHeader eyebrow="WhatsApp inteligente" title="Mensajes" action={<FeatureStateBadge state="demo" />} />
      {urgent > 0 && <div className="attention-banner"><BellRing size={20} /><span><strong>{urgent} conversación necesita atención</strong><small>La IA ha detectado que debe intervenir una persona.</small></span></div>}
      <div className="message-tabs"><button className="is-active" type="button">Todas</button><button type="button">Pendientes</button><button type="button">Atendidas</button></div>
      <div className="conversation-list">
        {conversations.map((conversation) => {
          const customer = findCustomer(mockCustomers, conversation.customerId);
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

function MorePage({ businessName, mode, navigate, onSignOut, serviceCount, staffCount }: { businessName: string; mode: 'mock' | 'supabase'; navigate: (route: BeautyRoute) => void; onSignOut: () => void; serviceCount: number; staffCount: number }) {
  const items = [
    { icon: Sparkles, label: 'Servicios', detail: `${serviceCount} servicios`, route: 'services' as BeautyRoute, state: mode === 'mock' ? 'demo' as const : undefined },
    { icon: UsersRound, label: 'Profesionales', detail: `${staffCount} profesionales`, route: 'staff' as BeautyRoute, state: mode === 'mock' ? 'demo' as const : undefined },
    { icon: Clock3, label: 'Horarios', detail: 'Semana, descansos y ausencias', route: 'schedules' as BeautyRoute, state: mode === 'mock' ? 'demo' as const : undefined },
    { icon: WandSparkles, label: 'Automatizaciones', detail: mode === 'mock' ? 'Vista conceptual' : 'No configurado', route: 'automations' as BeautyRoute, state: mode === 'mock' ? 'demo' as const : 'soon' as const },
    { icon: Settings2, label: 'Configuración', detail: 'Preferencias · Próximamente' },
    { icon: UserRound, label: 'Perfil del negocio', detail: `${businessName} · Edición próximamente` },
  ];
  return (
    <div className="beauty-page">
      <PageHeader eyebrow="Tu espacio de trabajo" title="Más" />
      <section className="business-card"><BeautyBrandMark size="lg" /><span><strong>{businessName}</strong><small>COSTABOTS Beauty · Sesión protegida</small></span><ShieldCheck size={20} /></section>
      <div className="more-list">
        {items.map(({ icon: Icon, label, detail, route, state }) => <button disabled={!route} key={label} onClick={() => route && navigate(route)} type="button"><span className="more-list__icon"><Icon size={21} /></span><span><strong>{label}</strong><small>{detail}</small></span>{state && <FeatureStateBadge state={state} />}{!route && <FeatureStateBadge state="soon" />}</button>)}
      </div>
      <div className="isolation-note"><ShieldCheck size={20} /><span><strong>{mode === 'mock' ? 'Modo demostración' : 'Conexión segura'}</strong><small>{mode === 'mock' ? 'Datos y acciones locales identificados como demo' : 'Solo están activas las operaciones conectadas y validadas'}</small></span></div>
      <button className="beauty-signout" onClick={onSignOut} type="button"><LogOut size={19} />Cerrar sesión</button>
    </div>
  );
}

function AutomationsPage({ mode, rules, setRules, onBack }: { mode: 'mock' | 'supabase'; rules: typeof initialAutomationRules; setRules: React.Dispatch<React.SetStateAction<typeof initialAutomationRules>>; onBack: () => void }) {
  function toggleRule(id: string) {
    setRules((current) => current.map((rule) => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule));
  }
  const metrics = [{ value: 38, label: 'Confirmadas' }, { value: 7, label: 'Canceladas a tiempo' }, { value: 12, label: 'Clientes recuperados' }, { value: 9, label: 'Nuevas reservas' }];
  return (
    <div className="beauty-page">
      <PageHeader eyebrow="Trabajan mientras tú atiendes" title="Automatizaciones" action={<div className="heading-actions"><FeatureStateBadge state={mode === 'mock' ? 'demo' : 'soon'} /><button aria-label="Volver" className="icon-button-soft" onClick={onBack} type="button"><ArrowLeft /></button></div>} />
      <div className={`automation-hero ${mode === 'supabase' ? 'automation-hero--inactive' : ''}`}><WandSparkles /><span><strong>{mode === 'mock' ? 'Vista conceptual de automatizaciones' : 'Automatizaciones no configuradas'}</strong><small>{mode === 'mock' ? 'Los cambios son locales y no envían mensajes.' : 'Recordatorios y reactivaciones estarán disponibles próximamente.'}</small></span></div>
      {mode === 'mock' && <section><Kicker>Impacto simulado este mes</Kicker><div className="automation-metrics">{metrics.map((metric) => <article key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}</div></section>}
      <AutomationGroup disabled={mode === 'supabase'} rules={rules.filter((rule) => rule.type === 'appointment')} title="Recordatorios de cita" toggleRule={toggleRule} />
      <AutomationGroup disabled={mode === 'supabase'} rules={rules.filter((rule) => rule.type === 'reactivation')} title="Reactivación de clientes" toggleRule={toggleRule} />
    </div>
  );
}

function AutomationGroup({ disabled, rules, title, toggleRule }: { disabled: boolean; rules: typeof initialAutomationRules; title: string; toggleRule: (id: string) => void }) {
  return <section><Kicker>{title}</Kicker><div className="automation-list">{rules.map((rule) => <article key={rule.id}><span><strong>{rule.name}</strong><small>{rule.daysAfter ? `${rule.daysAfter} días · ` : ''}{rule.description}{disabled ? ' · No configurado' : ''}</small></span><button aria-label={`${rule.enabled ? 'Desactivar' : 'Activar'} ${rule.name}`} aria-pressed={rule.enabled} className={`beauty-toggle ${rule.enabled ? 'is-on' : ''}`} disabled={disabled} onClick={() => toggleRule(rule.id)} type="button"><span /></button></article>)}</div></section>;
}

const primaryStatusActions: Partial<Record<AppointmentStatus, { status: AppointmentStatus; label: string }>> = {
  pending: { status: 'confirmed', label: 'Confirmar' },
  confirmed: { status: 'completed', label: 'Finalizar' },
  arrived: { status: 'completed', label: 'Finalizar' },
  in_service: { status: 'completed', label: 'Finalizar' },
};

const secondaryStatusActions: Partial<Record<AppointmentStatus, Array<{ status: AppointmentStatus; label: string; confirmation: string }>>> = {
  pending: [{ status: 'cancelled', label: 'Cancelar', confirmation: '¿Cancelar esta cita? El hueco volverá a quedar disponible.' }],
  confirmed: [
    { status: 'no_show', label: 'No presentado', confirmation: '¿Marcar esta cita como no presentada?' },
    { status: 'cancelled', label: 'Cancelar', confirmation: '¿Cancelar esta cita? El hueco volverá a quedar disponible.' },
  ],
};

function AppointmentDetail({ appointment, appointmentServices, customers, onClose, onOpenConversation, onStatusChange, readOnly, services, showToast, staff }: { appointment: Appointment; appointmentServices: import('./data/types').AppointmentService[]; customers: Customer[]; onClose: () => void; onOpenConversation: () => void; onStatusChange: (status: AppointmentStatus) => Promise<void>; readOnly: boolean; services: import('./types').BeautyService[]; showToast: (message: string) => void; staff: import('./types').StaffMember[] }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const customer = findCustomer(customers, appointment.customerId);
  const service = findService(services, appointment.serviceId);
  const linkedServices = appointmentServices.filter((item) => item.appointmentId === appointment.id).sort((a, b) => a.position - b.position);
  const member = findStaff(staff, appointment.staffId);
  const primaryAction = primaryStatusActions[appointment.status];
  const secondaryActions = secondaryStatusActions[appointment.status] ?? [];

  async function changeStatus(status: AppointmentStatus, confirmation?: string) {
    if (confirmation && !window.confirm(confirmation)) return;
    setSaveError('');
    setSaving(true);
    try {
      await onStatusChange(status);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'No hemos podido guardar el estado.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Sheet onClose={onClose} subtitle={`${dateLabels[appointment.date] ?? appointment.date} · ${appointment.start}`} title={service.name} wide>
      <div className="appointment-detail-hero"><CustomerIdentity customer={customer} large /><StatusBadge status={appointment.status} /></div>
      <div className="detail-grid">
        <DetailRow icon={<UserRound size={18} />} label="Profesional" value={member.name} />
        <DetailRow icon={<Clock3 size={18} />} label="Horario" value={`${appointment.start}–${appointment.end} · ${appointment.totalDurationMinutes ?? service.durationMinutes} min`} />
        <DetailRow icon={<Sparkles size={18} />} label="Precio" value={`${appointment.totalPrice ?? service.price} ${appointment.currency === 'EUR' || !appointment.currency ? '€' : appointment.currency}`} />
        <DetailRow icon={<MessageCircle size={18} />} label="Origen" value={appointment.source} />
        <DetailRow icon={<Phone size={18} />} label="Teléfono" value={customer.maskedPhone} />
      </div>
      {appointment.notes && <div className="detail-note"><strong>Notas</strong><p>{appointment.notes}</p></div>}
      <section><Kicker>Servicios</Kicker><div className="appointment-service-list">{linkedServices.length ? linkedServices.map((item) => <span key={item.id}><strong>{findService(services, item.serviceId).name}</strong><small>{item.durationMinutes} min · {item.price} €</small></span>) : <span><strong>{service.name}</strong><small>Datos de servicio incompletos</small></span>}</div></section>
      {appointment.hasReferencePhoto && <div className="reference-photo"><Image size={24} /><span><strong>Fotografía de referencia</strong><small>Vista simulada, sin archivo real</small></span></div>}
      <section><Kicker>Historial</Kicker>{appointment.historyError ? <p className="inline-data-message">No se ha podido cargar el historial.</p> : !appointment.historyLoaded && readOnly ? <p className="inline-data-message">Cargando historial…</p> : <div className="history-list">{appointment.history.map((item) => <div key={item.id}><span /><p><strong>{item.label}</strong><small>{item.at}</small></p></div>)}</div>}</section>
      <section><Kicker>Acciones</Kicker>{saveError && <p className="form-error" role="alert">{saveError}</p>}<div className="detail-actions">
        {primaryAction && <button className="primary-detail-action" disabled={saving} onClick={() => void changeStatus(primaryAction.status)} type="button">{saving ? 'Guardando…' : primaryAction.label}</button>}
        {secondaryActions.map((transition) => <button className="danger-action" disabled={saving} key={transition.status} onClick={() => void changeStatus(transition.status, transition.confirmation)} type="button">{transition.label}</button>)}
        {['pending', 'confirmed'].includes(appointment.status) && <button disabled type="button">Reprogramar · Próximamente</button>}
        {!readOnly && <button onClick={onOpenConversation} type="button">Abrir conversación</button>}
        {!readOnly && <button onClick={() => showToast('Llamada deshabilitada en el prototipo')} type="button">Llamar</button>}
      </div>{readOnly && !primaryAction && secondaryActions.length === 0 && <div className="read-only-note"><ShieldCheck size={18} /><span><strong>Sin acciones disponibles</strong><small>Este estado no admite cambios desde el Manager.</small></span></div>}</section>
    </Sheet>
  );
}

function CustomerDetail({ canManage, customer, getHistory, mode, onClose, onCreateAppointment, onDeactivate, onEdit, onOpenAppointment, services, staff, today }: { canManage: boolean; customer: Customer; getHistory: (customerId: string) => Promise<import('./data/types').CustomerHistory>; mode: 'mock' | 'supabase'; onClose: () => void; onCreateAppointment: () => void; onDeactivate: () => Promise<void>; onEdit: () => void; onOpenAppointment: (appointment: Appointment, services: import('./data/types').AppointmentService[]) => void; services: import('./types').BeautyService[]; staff: import('./types').StaffMember[]; today: string }) {
  const [history, setHistory] = useState<import('./data/types').CustomerHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [deactivating, setDeactivating] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    let active = true;
    setHistory(null);
    setHistoryError('');
    void getHistory(customer.id)
      .then((result) => { if (active) setHistory(result); })
      .catch(() => { if (active) setHistoryError('No hemos podido cargar el historial completo.'); });
    return () => { active = false; };
  }, [customer.id, getHistory]);

  const customerAppointments = history?.appointments ?? [];
  const orderedAppointments = [...customerAppointments].sort((a, b) => `${b.date}${b.start}`.localeCompare(`${a.date}${a.start}`));
  const completed = orderedAppointments.filter((appointment) => appointment.status === 'completed' && appointment.date <= today);
  const upcoming = [...customerAppointments]
    .filter((appointment) => appointment.date >= today && !['completed', 'cancelled', 'no_show'].includes(appointment.status))
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`));
  const serviceCounts = new Map<string, number>();
  history?.appointmentServices.forEach((item) => serviceCounts.set(item.serviceId, (serviceCounts.get(item.serviceId) ?? 0) + 1));
  const usualServices = [...serviceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([serviceId]) => findService(services, serviceId).name);

  async function deactivate() {
    const futureCount = upcoming.length;
    const warning = futureCount
      ? `Este cliente tiene ${futureCount} cita${futureCount === 1 ? '' : 's'} futura${futureCount === 1 ? '' : 's'}. Se desactivará el cliente, pero las citas no se cancelarán. ¿Continuar?`
      : 'El cliente dejará de aparecer en el listado activo. Su historial se conservará. ¿Continuar?';
    if (!window.confirm(warning)) return;
    setActionError('');
    setDeactivating(true);
    try {
      await onDeactivate();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'No hemos podido desactivar el cliente.');
      setDeactivating(false);
    }
  }

  return (
    <Sheet onClose={onClose} subtitle={`Ficha de cliente${mode === 'mock' ? ' · Demo' : ''}`} title={customer.name} wide>
      <CustomerIdentity customer={customer} large />
      {customer.active === false && <div className="inactive-customer-banner"><ShieldCheck size={18} /><span><strong>Cliente inactivo</strong><small>El historial se conserva, pero no se pueden crear nuevas citas.</small></span></div>}
      <div className="detail-grid detail-grid--single">
        <DetailRow icon={<Phone size={18} />} label="Teléfono" value={customer.phone || 'Sin teléfono'} />
        <DetailRow icon={<MessageCircle size={18} />} label="Email" value={customer.email || 'Sin email'} />
        <DetailRow icon={<UserRound size={18} />} label="Profesional preferido" value={customer.preferredStaffId ? findStaff(staff, customer.preferredStaffId).name : 'Sin preferencia'} />
        <DetailRow icon={<BellRing size={18} />} label="Recordatorios" value={customer.reminderConsent ? 'Permitidos' : 'No permitidos'} />
        <DetailRow icon={<ShieldCheck size={18} />} label="Comunicaciones comerciales" value={customer.marketingConsent ? 'Permitidas' : 'No permitidas'} />
      </div>
      <div className="customer-metrics">
        <article><small>Total de citas</small><strong>{history ? customerAppointments.length : '—'}</strong></article>
        <article><small>Última visita</small><strong>{completed[0]?.date ?? 'Sin visitas'}</strong></article>
        <article><small>Próxima cita</small><strong>{upcoming[0] ? `${upcoming[0].date} · ${upcoming[0].start}` : 'Sin cita'}</strong></article>
      </div>
      <DetailRow icon={<Sparkles size={18} />} label="Servicios habituales" value={usualServices.length ? usualServices.join(', ') : 'Sin historial'} />
      <div className="detail-note"><strong>Notas</strong><p>{customer.notes || 'Sin notas.'}</p></div>
      <section><div className="section-heading"><Kicker>Historial completo</Kicker>{history && <span>{customerAppointments.length} citas</span>}</div>{historyError ? <p className="form-error">{historyError}</p> : !history ? <p className="inline-data-message">Cargando historial…</p> : orderedAppointments.length ? <div className="mini-appointment-list">{orderedAppointments.map((appointment) => <button key={appointment.id} onClick={() => onOpenAppointment(appointment, history.appointmentServices.filter((item) => item.appointmentId === appointment.id))} type="button"><span><strong>{findService(services, appointment.serviceId).name}</strong><small>{dateLabels[appointment.date] ?? appointment.date} · {appointment.start}</small></span><StatusBadge status={appointment.status} /></button>)}</div> : <p className="inline-data-message">Este cliente todavía no tiene citas.</p>}</section>
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      <section><Kicker>Acciones</Kicker><div className="detail-actions customer-detail-actions">
        <button disabled={customer.active === false} onClick={onCreateAppointment} type="button"><CalendarDays size={17} />Nueva cita</button>
        <button disabled={!canManage} onClick={onEdit} type="button"><UserRound size={17} />Editar cliente</button>
        {customer.active !== false && <button className="danger-action" disabled={!canManage || deactivating} onClick={() => void deactivate()} type="button">{deactivating ? 'Desactivando…' : 'Desactivar cliente'}</button>}
      </div></section>
    </Sheet>
  );
}

function ConversationDetail({ conversation, onClose, onStatusChange }: { conversation: Conversation; onClose: () => void; onStatusChange: (status: ConversationStatus) => void }) {
  const customer = findCustomer(mockCustomers, conversation.customerId);
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
