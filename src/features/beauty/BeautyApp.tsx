import {
  ArrowLeft,
  BellRing,
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
import { useEffect, useState } from 'react';
import { beautyEnvironment } from '../../config/environment';
import { useAuth } from '../auth/hooks/AuthProvider';
import { signOut } from '../auth/services/authService';
import { useBeautyBusiness } from './context/BeautyBusinessProvider';
import { BeautyDataProvider, useBeautyData } from './context/BeautyDataProvider';
import {
  automationRules as initialAutomationRules,
  business,
  conversations as initialConversations,
  customers as mockCustomers,
} from './mock/data';
import type { Appointment, AppointmentStatus, BeautyRoute, Conversation, ConversationStatus, Customer } from './types';
import {
  AppointmentCard,
  Avatar,
  BeautyNavigation,
  CustomerIdentity,
  DetailRow,
  FeatureStateBadge,
  PageHeader,
  Sheet,
  StatusBadge,
} from './components/ui';
import { BeautyBrandLockup, BeautyBrandMark } from './components/BeautyBrand';
import { CustomerForm } from './components/CustomerForm';
import { SchedulesManagementPage, ServicesManagementPage, StaffManagementPage } from './components/BusinessSetup';
import { ConfigurationPage, OnboardingPage, type SetupProgress } from './components/BusinessConfiguration';
import { localDateTimeToIso } from './data/mappers';
import { addCalendarDays, dateInTimeZone, formatBusinessDate, formatWeekLabel, weekRange } from './data/dateRange';
import './beauty.css';

function dateLabel(date: string, timezone = 'Europe/Madrid') {
  return formatBusinessDate(date, timezone);
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

export function BeautyApp({ initialRoute = 'today' }: { initialRoute?: BeautyRoute }) {
  return <BeautyDataProvider><BeautyDataGate initialRoute={initialRoute} /></BeautyDataProvider>;
}

function BeautyDataGate({ initialRoute }: { initialRoute: BeautyRoute }) {
  const beautyData = useBeautyData();
  if (beautyData.status === 'loading') {
    return <div className="beauty-data-state" role="status"><BeautyBrandMark size="lg" /><span className="beauty-data-spinner" /><h1>Cargando tu negocio…</h1><p>Estamos preparando agenda, clientes y equipo.</p></div>;
  }
  if (beautyData.status === 'error') {
    return <div className="beauty-data-state" role="alert"><ShieldCheck size={32} /><h1>No podemos cargar los datos</h1><p>{beautyData.message}</p><button onClick={beautyData.retry} type="button">Volver a intentar</button></div>;
  }
  return <BeautyManager initialRoute={initialRoute} />;
}

function BeautyManager({ initialRoute }: { initialRoute: BeautyRoute }) {
  void beautyEnvironment.productId;
  const auth = useAuth();
  const membership = useBeautyBusiness();
  const beautyData = useBeautyData();
  if (beautyData.status !== 'ready') return null;
  const { appointments: loadedAppointments, customers, services, staff, timeBlocks } = beautyData.data;
  const businessName = beautyData.data.business.name;
  const mode = beautyData.mode;
  const operationalToday = dateInTimeZone(beautyData.data.business.timezone);
  const ownerDisplayName = auth.user?.user_metadata?.full_name
    ?? auth.user?.user_metadata?.name
    ?? auth.user?.user_metadata?.owner_display_name
    ?? auth.user?.email?.split('@')[0]
    ?? business.ownerName;
  const [route, setRoute] = useState<BeautyRoute>(initialRoute);
  const [appointments, setAppointments] = useState(loadedAppointments);
  const [conversations, setConversations] = useState(initialConversations);
  const [automationRules, setAutomationRules] = useState(initialAutomationRules);
  const [selectedDate, setSelectedDate] = useState(operationalToday);
  const [staffFilter, setStaffFilter] = useState('all');
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [appointmentCustomerId, setAppointmentCustomerId] = useState<string | null>(null);
  const [extraAppointmentServices, setExtraAppointmentServices] = useState<import('./data/types').AppointmentService[]>([]);
  const [setupStaffId, setSetupStaffId] = useState<string | undefined>();
  const [setupReturnRoute, setSetupReturnRoute] = useState<BeautyRoute>('more');
  const [toast, setToast] = useState('');
  const [activeForm, setActiveForm] = useState<'appointment' | 'edit-appointment' | 'block' | 'edit-block' | 'customer' | 'edit-customer' | null>(null);
  const canManageCustomers = membership.role === 'owner' || membership.role === 'admin';
  const activeStaff = staff.filter((item) => item.active !== false);
  const activeServices = services.filter((item) => item.active !== false);
  const activeStaffIds = new Set(activeStaff.map((item) => item.id));
  const activeServiceIds = new Set(activeServices.map((item) => item.id));
  const hasAssignment = beautyData.data.staffServices.some((item) => item.active && activeStaffIds.has(item.staffId) && activeServiceIds.has(item.serviceId));
  const hasSchedule = beautyData.data.schedules.some((item) => item.active && activeStaffIds.has(item.staffId));
  const setupProgress: SetupProgress = {
    business: Boolean(businessName.trim() && beautyData.data.business.timezone && /^[A-Z]{3}$/.test(beautyData.data.business.currency)),
    staff: activeStaff.length > 0,
    services: activeServices.length > 0,
    assignment: hasAssignment,
    schedule: hasSchedule,
    complete: false,
    completedCount: 0,
  };
  setupProgress.complete = setupProgress.business && setupProgress.staff && setupProgress.services && setupProgress.assignment && setupProgress.schedule;
  setupProgress.completedCount = [setupProgress.business, setupProgress.staff, setupProgress.services && setupProgress.assignment, setupProgress.schedule, setupProgress.complete].filter(Boolean).length;

  useEffect(() => {
    setAppointments(loadedAppointments);
  }, [loadedAppointments]);

  useEffect(() => {
    const range = weekRange(selectedDate);
    if (beautyData.agendaRange?.from !== range.from || beautyData.agendaRange?.to !== range.to) {
      void beautyData.loadAgendaRange(range);
    }
  }, [beautyData.agendaRange?.from, beautyData.agendaRange?.to, beautyData.loadAgendaRange, selectedDate]);

  const selectedAppointment = appointments.find((appointment) => appointment.id === selectedAppointmentId) ?? null;
  const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const selectedBlock = timeBlocks.find((block) => block.id === selectedBlockId) ?? null;
  const selectedConversation = conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;

  useEffect(() => {
    if (selectedAppointmentId) void beautyData.loadAppointmentHistory(selectedAppointmentId);
  }, [beautyData.loadAppointmentHistory, selectedAppointmentId]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(''), 2300);
  }

  function navigate(nextRoute: BeautyRoute) {
    if (route === 'more' && ['staff', 'services', 'schedules'].includes(nextRoute)) setSetupReturnRoute('more');
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openSetup(routeName: 'staff' | 'services' | 'schedules', returnTo: BeautyRoute = 'more') {
    setSetupReturnRoute(returnTo);
    navigate(routeName);
  }

  function openNewAppointment() {
    if (!setupProgress.complete) {
      showToast('Completa profesional, servicio, asignación y horario antes de crear citas.');
      navigate('onboarding');
      return;
    }
    setActiveForm('appointment');
  }

  async function updateAppointmentStatus(appointmentId: string, status: AppointmentStatus) {
    if (status === 'cancelled') {
      const reason = window.prompt('Motivo de cancelación (opcional):', 'Cliente cancela');
      if (reason === null) return;
      await beautyData.cancelAppointment({ appointmentId, reason });
      showToast(beautyData.mode === 'supabase' ? 'Cita cancelada' : 'Cita cancelada en la demo');
      return;
    }
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
        {mode === 'mock' && <div className="mode-notice"><FeatureStateBadge state="demo" /><span>Los cambios se guardan únicamente en este navegador y pueden reiniciarse desde Configuración.</span></div>}
        {route === 'today' && <TodayPage appointments={appointments} businessName={businessName} customers={customers} navigate={navigate} onContinueSetup={() => navigate('onboarding')} onCreateAppointment={() => { setSelectedDate(operationalToday); openNewAppointment(); }} onCreateBlock={() => { setSelectedDate(operationalToday); setActiveForm('block'); }} onOpenAppointment={setSelectedAppointmentId} onStatusChange={updateAppointmentStatus} ownerDisplayName={ownerDisplayName} services={services} setupProgress={setupProgress} staff={staff} today={operationalToday} timezone={beautyData.data.business.timezone} />}
        {route === 'agenda' && <AgendaPage agendaMessage={beautyData.agendaMessage} agendaRange={beautyData.agendaRange ?? weekRange(selectedDate)} agendaStatus={beautyData.agendaStatus} appointments={appointments} customers={customers} date={selectedDate} mode={mode} onCreateAppointment={openNewAppointment} onCreateBlock={() => setActiveForm('block')} onDateChange={setSelectedDate} onOpenAppointment={setSelectedAppointmentId} onOpenBlock={(id) => { setSelectedBlockId(id); setActiveForm('edit-block'); }} onRetry={beautyData.retryAgenda} onStatusChange={updateAppointmentStatus} services={services} staff={staff} staffFilter={staffFilter} setStaffFilter={setStaffFilter} timeBlocks={timeBlocks} timezone={beautyData.data.business.timezone} today={operationalToday} />}
        {route === 'customers' && <CustomersPage canManage={canManageCustomers} customers={customers} mode={mode} onCreateCustomer={() => setActiveForm('customer')} onOpenCustomer={setSelectedCustomerId} />}
        {route === 'messages' && <MessagesPage conversations={conversations} mode={mode} onOpenConversation={setSelectedConversationId} />}
        {route === 'more' && <MorePage businessName={businessName} mode={mode} navigate={navigate} progress={setupProgress} serviceCount={services.length} staffCount={staff.length} />}
        {route === 'automations' && <AutomationsPage mode={mode} rules={automationRules} setRules={setAutomationRules} onBack={() => navigate('more')} />}
        {route === 'staff' && <StaffManagementPage appointments={appointments} canManage={canManageCustomers} mode={mode} onBack={() => navigate(setupReturnRoute)} onCreate={beautyData.createStaff} onDeactivate={(staffId) => beautyData.deactivateStaff({ staffId })} onOpenSchedules={(staffId) => { setSetupStaffId(staffId); openSetup('schedules', setupReturnRoute); }} onSetAssignment={beautyData.setStaffService} onUpdate={beautyData.updateStaff} services={services} staff={staff} staffServices={beautyData.data.staffServices} />}
        {route === 'services' && <ServicesManagementPage businessCurrency={beautyData.data.business.currency} canManage={canManageCustomers} mode={mode} onBack={() => navigate(setupReturnRoute)} onCreate={beautyData.createService} onDeactivate={(serviceId) => beautyData.deactivateService({ serviceId })} onSetAssignment={beautyData.setStaffService} onUpdate={beautyData.updateService} services={services} staff={staff} staffServices={beautyData.data.staffServices} />}
        {route === 'schedules' && <SchedulesManagementPage initialStaffId={setupStaffId} mode={mode} onBack={() => navigate(setupReturnRoute)} onCreateAbsence={(staffId) => { setSetupStaffId(staffId); setActiveForm('block'); }} onSave={(staffId, segments) => beautyData.replaceWeeklySchedule({ staffId, segments })} schedules={beautyData.data.schedules} staff={staff} />}
        {route === 'configuration' && <ConfigurationPage business={beautyData.data.business} canManage={canManageCustomers} mode={mode} onBack={() => navigate('more')} onOpenOnboarding={() => navigate('onboarding')} onSave={beautyData.updateBusinessProfile} onSignOut={() => void signOut()} progress={setupProgress} />}
        {route === 'onboarding' && <OnboardingPage business={beautyData.data.business} canManage={canManageCustomers} mode={mode} onBack={() => navigate('today')} onOpenSchedules={() => openSetup('schedules', 'onboarding')} onOpenServices={() => openSetup('services', 'onboarding')} onOpenStaff={() => openSetup('staff', 'onboarding')} onSaveBusiness={beautyData.updateBusinessProfile} progress={setupProgress} />}
      </main>

      <BeautyNavigation active={['automations', 'staff', 'services', 'schedules', 'configuration', 'onboarding'].includes(route) ? 'more' : route} onNavigate={navigate} />

      {selectedAppointment && (
        <AppointmentDetail
          appointment={selectedAppointment}
          appointmentServices={[...beautyData.data.appointmentServices, ...extraAppointmentServices]}
          customers={customers}
          readOnly={!canManageCustomers}
          services={services}
          staff={staff}
          timezone={beautyData.data.business.timezone}
          onClose={() => setSelectedAppointmentId(null)}
          onOpenConversation={() => {
            const conversation = conversations.find((item) => item.customerId === selectedAppointment.customerId);
            setSelectedAppointmentId(null);
            navigate('messages');
            setSelectedConversationId(conversation?.id ?? null);
          }}
          onStatusChange={(status) => updateAppointmentStatus(selectedAppointment.id, status)}
          onEdit={() => setActiveForm('edit-appointment')}
          showToast={showToast}
        />
      )}
      {selectedCustomer && <CustomerDetail canManage={canManageCustomers} customer={selectedCustomer} getHistory={beautyData.getCustomerHistory} mode={mode} onClose={() => setSelectedCustomerId(null)} onCreateAppointment={() => { setAppointmentCustomerId(selectedCustomer.id); setSelectedCustomerId(null); openNewAppointment(); }} onDeactivate={async () => { await beautyData.deactivateCustomer({ customerId: selectedCustomer.id }); showToast(mode === 'mock' ? 'Cliente desactivado en la demo' : 'Cliente desactivado'); }} onEdit={() => setActiveForm('edit-customer')} onOpenAppointment={(appointment, linkedServices) => { setAppointments((current) => current.some((item) => item.id === appointment.id) ? current : [...current, appointment]); setExtraAppointmentServices((current) => [...current.filter((item) => item.appointmentId !== appointment.id), ...linkedServices]); setSelectedCustomerId(null); setSelectedAppointmentId(appointment.id); }} services={services} staff={staff} timezone={beautyData.data.business.timezone} today={operationalToday} />}
      {selectedConversation && (
        <ConversationDetail
          conversation={selectedConversation}
          onClose={() => setSelectedConversationId(null)}
          onStatusChange={(status) => updateConversationStatus(selectedConversation.id, status)}
        />
      )}
      {activeForm === 'block' && <TimeBlockForm defaultDate={selectedDate} initialStaffId={setupStaffId} maxDate={addCalendarDays(operationalToday, 730)} minDate={addCalendarDays(operationalToday, -365)} onClose={() => setActiveForm(null)} onCreate={beautyData.createTimeBlock} onSaved={() => { setActiveForm(null); showToast(beautyData.mode === 'supabase' ? 'Tiempo no disponible guardado' : 'Tiempo no disponible creado en la demo'); }} staff={staff.filter((item) => item.active !== false)} />}
      {activeForm === 'edit-block' && selectedBlock && <TimeBlockForm block={selectedBlock} defaultDate={selectedBlock.date} initialStaffId={selectedBlock.staffId} maxDate={addCalendarDays(operationalToday, 730)} minDate={addCalendarDays(operationalToday, -365)} onClose={() => { setActiveForm(null); setSelectedBlockId(null); }} onCreate={async () => {}} onDeactivate={() => beautyData.deactivateTimeBlock({ blockId: selectedBlock.id })} onSaved={() => { setActiveForm(null); setSelectedBlockId(null); showToast(beautyData.mode === 'supabase' ? 'Tiempo no disponible actualizado' : 'Tiempo no disponible actualizado en la demo'); }} onUpdate={beautyData.updateTimeBlock} staff={staff.filter((item) => item.active !== false)} />}
      {activeForm === 'appointment' && setupProgress.complete && <NewAppointmentForm customers={customers.filter((customer) => customer.active !== false)} defaultDate={selectedDate} initialCustomerId={appointmentCustomerId} maxDate={addCalendarDays(operationalToday, 730)} minDate={addCalendarDays(operationalToday, -365)} onClose={() => { setActiveForm(null); setAppointmentCustomerId(null); }} onCreate={async (command) => { const id = await beautyData.createAppointment(command); setActiveForm(null); setAppointmentCustomerId(null); setSelectedAppointmentId(id); showToast(beautyData.mode === 'supabase' ? 'Cita creada' : 'Cita creada en la demo'); }} onGetAvailability={beautyData.getAvailability} services={services.filter((item) => item.active !== false)} staff={staff.filter((item) => item.active !== false)} staffServices={beautyData.data.staffServices.filter((item) => item.active)} timezone={beautyData.data.business.timezone} />}
      {activeForm === 'edit-appointment' && selectedAppointment && <NewAppointmentForm appointment={selectedAppointment} customers={customers.filter((customer) => customer.active !== false)} defaultDate={selectedAppointment.date} initialCustomerId={selectedAppointment.customerId} maxDate={addCalendarDays(operationalToday, 730)} minDate={addCalendarDays(operationalToday, -365)} onClose={() => setActiveForm(null)} onCreate={async () => {}} onUpdate={async (command) => { await beautyData.updateAppointment(command); setActiveForm(null); showToast(beautyData.mode === 'supabase' ? 'Cita actualizada' : 'Cita actualizada en la demo'); }} onGetAvailability={beautyData.getAvailability} services={services.filter((item) => item.active !== false)} staff={staff.filter((item) => item.active !== false)} staffServices={beautyData.data.staffServices.filter((item) => item.active)} timezone={beautyData.data.business.timezone} />}
      {activeForm === 'customer' && <CustomerForm mode={mode} onClose={() => setActiveForm(null)} onSave={async (value) => { const id = await beautyData.createCustomer(value); setActiveForm(null); setSelectedCustomerId(id); showToast(mode === 'mock' ? 'Cliente creado en la demo' : 'Cliente creado'); }} staff={staff} />}
      {activeForm === 'edit-customer' && selectedCustomer && <CustomerForm customer={selectedCustomer} mode={mode} onClose={() => setActiveForm(null)} onSave={async (value) => { await beautyData.updateCustomer({ ...value, customerId: selectedCustomer.id }); setActiveForm(null); showToast(mode === 'mock' ? 'Cliente actualizado en la demo' : 'Cliente actualizado'); }} staff={staff} />}
      {toast && <div className="beauty-toast"><Check size={17} />{toast}</div>}
    </div>
  );
}

function TodayPage({ appointments, businessName, customers, navigate, onContinueSetup, onCreateAppointment, onCreateBlock, onOpenAppointment, onStatusChange, ownerDisplayName, services, setupProgress, staff, today, timezone }: { appointments: Appointment[]; businessName: string; customers: Customer[]; navigate: (route: BeautyRoute) => void; onContinueSetup: () => void; onCreateAppointment: () => void; onCreateBlock: () => void; onOpenAppointment: (id: string) => void; onStatusChange: (appointmentId: string, status: AppointmentStatus) => Promise<void>; ownerDisplayName: string; services: import('./types').BeautyService[]; setupProgress: SetupProgress; staff: import('./types').StaffMember[]; today: string; timezone: string }) {
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

      {!setupProgress.complete && <section className="setup-reminder">
        <span><strong>Termina la configuración para empezar a gestionar citas</strong><small>{setupProgress.completedCount} de 5 requisitos completados</small></span>
        <div className="setup-reminder__progress"><span style={{ width: `${(setupProgress.completedCount / 5) * 100}%` }} /></div>
        <button onClick={onContinueSetup} type="button">Continuar configuración</button>
      </section>}

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
        </div> : <div className="empty-state"><CalendarDays /><h2>No tienes citas hoy</h2><p>Puedes reservar una cita o marcar el tiempo que no está disponible.</p><div className="empty-state__actions"><button onClick={onCreateAppointment} type="button"><CirclePlus size={17} />Nueva cita</button><button onClick={onCreateBlock} type="button"><Clock3 size={17} />Tiempo no disponible</button></div></div>}
      </section>

      <section>
        <Kicker>Acciones</Kicker>
        <div className="quick-actions">
          <button onClick={onCreateAppointment} type="button"><CirclePlus /><span>Nueva cita</span></button>
          <button onClick={onCreateBlock} type="button"><Clock3 /><span>Tiempo no disponible</span></button>
        </div>
      </section>
    </div>
  );
}

function AgendaPage({ agendaMessage, agendaRange, agendaStatus, appointments, customers, date, mode, onCreateAppointment, onCreateBlock, onDateChange, onOpenAppointment, onOpenBlock, onRetry, onStatusChange, services, staff, staffFilter, setStaffFilter, timeBlocks, timezone, today }: { agendaMessage: string | null; agendaRange: import('./data/types').DateRange; agendaStatus: 'idle' | 'loading' | 'ready' | 'error'; appointments: Appointment[]; customers: Customer[]; date: string; mode: 'mock' | 'supabase'; onCreateAppointment: () => void; onCreateBlock: () => void; onDateChange: (date: string) => void; onOpenAppointment: (id: string) => void; onOpenBlock: (id: string) => void; onRetry: () => void; onStatusChange: (appointmentId: string, status: AppointmentStatus) => Promise<void>; services: import('./types').BeautyService[]; staff: import('./types').StaffMember[]; staffFilter: string; setStaffFilter: (id: string) => void; timeBlocks: import('./types').TimeBlock[]; timezone: string; today: string }) {
  const activeStaff = staff.filter((member) => member.active !== false);
  const effectiveFilter = activeStaff.length > 1 ? staffFilter : 'all';
  const visibleAppointments = appointments
    .filter((appointment) => appointment.date === date && (effectiveFilter === 'all' || appointment.staffId === effectiveFilter))
    .sort((a, b) => a.start.localeCompare(b.start));
  const visibleBlocks = timeBlocks.filter((block) => block.date === date && (effectiveFilter === 'all' || block.staffId === effectiveFilter || block.staffId === 'all'));

  return (
    <div className="beauty-page">
      <PageHeader eyebrow="Organiza tu día" title="Agenda" action={<div className="heading-actions"><button className="primary-icon-button" onClick={() => onDateChange(today)} type="button">Hoy</button><button aria-label="Tiempo no disponible" className="icon-button-soft" onClick={onCreateBlock} type="button"><Clock3 size={17} /></button><button aria-label="Nueva cita" className="primary-icon-button" onClick={onCreateAppointment} type="button"><CirclePlus size={17} /></button></div>} />
      <div className="week-switcher">
        <button aria-label="Semana anterior" onClick={() => onDateChange(addCalendarDays(date, -7))} type="button"><ChevronLeft /></button>
        <span><small>Semana visible</small><strong>{formatWeekLabel(agendaRange, timezone)}</strong></span>
        <button aria-label="Semana siguiente" onClick={() => onDateChange(addCalendarDays(date, 7))} type="button"><ChevronRight /></button>
      </div>
      <div className="date-switcher">
        <button aria-label="Día anterior" onClick={() => onDateChange(addCalendarDays(date, -1))} type="button"><ChevronLeft /></button>
        <span><small>Vista diaria</small><strong>{dateLabel(date, timezone)}</strong></span>
        <button aria-label="Día siguiente" onClick={() => onDateChange(addCalendarDays(date, 1))} type="button"><ChevronRight /></button>
      </div>
      {activeStaff.length > 1 && <div className="staff-filters" role="group" aria-label="Filtrar por profesional">
        <button className={staffFilter === 'all' ? 'is-active' : ''} onClick={() => setStaffFilter('all')} type="button"><UsersRound size={17} />Todos</button>
        {activeStaff.map((member) => <button className={staffFilter === member.id ? 'is-active' : ''} key={member.id} onClick={() => setStaffFilter(member.id)} type="button"><Avatar accent={member.accent} name={member.name} size="sm" />{member.name}</button>)}
      </div>}
      <div className="agenda-summary"><span><strong>{visibleAppointments.length}</strong> citas</span><span><strong>{visibleBlocks.length}</strong> tiempos no disponibles{mode === 'mock' ? ' · Demo' : ''}</span></div>
      {agendaStatus === 'loading' && <div className="agenda-range-state" role="status"><span className="loading-spinner" />Cargando este periodo…</div>}
      {agendaStatus === 'error' && <div className="agenda-range-state agenda-range-state--error" role="alert"><span>{agendaMessage ?? 'No hemos podido cargar este periodo.'}</span><button onClick={onRetry} type="button">Reintentar</button></div>}
      <div className="agenda-timeline">
        {agendaStatus !== 'error' && visibleAppointments.map((appointment) => (
          <div key={appointment.id}>
            <AppointmentCard appointment={appointment} customer={findCustomer(customers, appointment.customerId)} onOpen={() => onOpenAppointment(appointment.id)} onStatusChange={onStatusChange} service={findService(services, appointment.serviceId)} staffMember={findStaff(staff, appointment.staffId)} />
          </div>
        ))}
        {agendaStatus !== 'error' && visibleBlocks.map((block) => <button className="time-block" key={block.id} onClick={() => onOpenBlock(block.id)} type="button"><Clock3 size={17} /><span><strong>{block.start}–{block.end}</strong>{block.reason || 'Tiempo no disponible'} · {block.staffId === 'all' ? 'Todo el negocio' : findStaff(staff, block.staffId).name}</span><span className="time-block__action">Editar</span></button>)}
        {agendaStatus === 'ready' && visibleAppointments.length === 0 && visibleBlocks.length === 0 && <div className="empty-state"><CalendarDays /><h2>No hay citas para este día</h2><p>Puedes crear una cita o marcar tiempo no disponible.</p><div className="empty-state__actions"><button onClick={onCreateAppointment} type="button"><CirclePlus size={17} />Nueva cita</button><button onClick={onCreateBlock} type="button"><Clock3 size={17} />Tiempo no disponible</button></div></div>}
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
      {filteredCustomers.length === 0 && <div className="empty-state"><UsersRound /><h2>{customers.length === 0 ? 'Aún no tienes clientes' : 'No hay resultados'}</h2><p>{customers.length === 0 ? 'Crea la primera ficha para guardar contacto, notas e historial.' : 'Prueba con otro nombre o teléfono.'}</p>{customers.length === 0 && <button disabled={!canManage} onClick={onCreateCustomer} type="button">Crear primer cliente</button>}</div>}
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

function TimeBlockForm({ block, defaultDate, initialStaffId, maxDate, minDate, onClose, onCreate, onDeactivate, onSaved, onUpdate, staff }: { block?: import('./types').TimeBlock; defaultDate: string; initialStaffId?: string; maxDate: string; minDate: string; onClose: () => void; onCreate: (command: import('./data/types').CreateTimeBlockCommand) => Promise<unknown>; onDeactivate?: () => Promise<unknown>; onSaved: () => void; onUpdate?: (command: import('./data/types').UpdateTimeBlockCommand) => Promise<unknown>; staff: import('./types').StaffMember[] }) {
  const membership = useBeautyBusiness();
  const canManageAll = membership.role === 'owner' || membership.role === 'admin';
  const [flow, setFlow] = useState<'short' | 'day' | 'range'>('short');
  const [staffId, setStaffId] = useState(initialStaffId ?? staff[0]?.id ?? '');
  const [date, setDate] = useState(block?.date ?? defaultDate);
  const [endDate, setEndDate] = useState(block?.date ?? defaultDate);
  const [start, setStart] = useState(block?.start ?? '13:00');
  const [end, setEnd] = useState(block?.end ?? '14:00');
  const [reason, setReason] = useState(block?.reason ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!date || (flow === 'short' && (!start || !end || start >= end))) {
      setError('La hora de inicio debe ser anterior a la hora de fin.');
      return;
    }
    if (flow === 'range' && (!endDate || endDate < date)) {
      setError('La fecha final debe ser igual o posterior a la inicial.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const targetStaffId = staffId === 'all' ? null : staffId;
      const type: import('./data/types').BeautyTimeBlockType = targetStaffId === null ? 'business_closed' : flow === 'range' ? 'vacation' : flow === 'day' ? 'absence' : 'break';
      if (block && onUpdate) {
        await onUpdate({ blockId: block.id, staffId: targetStaffId, date, start, end, type, reason, notes: '' });
      } else if (flow === 'range') {
        let cursor = date;
        while (cursor <= endDate) {
          await onCreate({ staffId: targetStaffId, date: cursor, start: '00:00', end: '23:59', type, reason, notes: '' });
          cursor = addCalendarDays(cursor, 1);
        }
      } else {
        await onCreate({ staffId: targetStaffId, date, start: flow === 'day' ? '00:00' : start, end: flow === 'day' ? '23:59' : end, type, reason, notes: '' });
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hemos podido guardar este tiempo no disponible.');
      setSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} subtitle="Reserva tiempo sin citas" title={block ? 'Editar tiempo no disponible' : 'Tiempo no disponible'}>
      <form className="beauty-command-form" onSubmit={submit}>
        {!block && <div className="time-block-flow" role="group" aria-label="Duración"><button aria-pressed={flow === 'short'} onClick={() => setFlow('short')} type="button">Un rato</button><button aria-pressed={flow === 'day'} onClick={() => setFlow('day')} type="button">Todo el día</button><button aria-pressed={flow === 'range'} onClick={() => setFlow('range')} type="button">Varios días</button></div>}
        {staff.length > 1 || canManageAll ? <label><span>Para quién</span><select onChange={(event) => setStaffId(event.target.value)} value={staffId}>{canManageAll && <option value="all">Todo el negocio</option>}{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label> : <p className="auto-selection-note">Se aplicará a {staff[0]?.name}.</p>}
        {flow === 'range' ? <div className="form-columns"><label><span>Desde</span><input max={maxDate} min={minDate} onChange={(event) => setDate(event.target.value)} required type="date" value={date} /></label><label><span>Hasta</span><input max={maxDate} min={date} onChange={(event) => setEndDate(event.target.value)} required type="date" value={endDate} /></label></div> : <label><span>Fecha</span><input max={maxDate} min={minDate} onChange={(event) => setDate(event.target.value)} required type="date" value={date} /></label>}
        {flow === 'short' && <div className="form-columns"><label><span>Desde</span><input onChange={(event) => setStart(event.target.value)} required type="time" value={start} /></label><label><span>Hasta</span><input onChange={(event) => setEnd(event.target.value)} required type="time" value={end} /></label></div>}
        <label><span>Motivo opcional</span><input maxLength={160} onChange={(event) => setReason(event.target.value)} placeholder="Ej. Cita médica" value={reason} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          {block && onDeactivate && <button className="danger-action" disabled={saving} onClick={() => { if (!window.confirm('¿Eliminar este tiempo no disponible?')) return; setSaving(true); void onDeactivate().then(onSaved).catch((caught) => { setError(caught instanceof Error ? caught.message : 'No hemos podido eliminar este tiempo.'); setSaving(false); }); }} type="button">Eliminar</button>}
          <button className="form-submit" disabled={saving} type="submit">{saving ? 'Guardando…' : block ? 'Guardar cambios' : 'Guardar'}</button>
        </div>
      </form>
    </Sheet>
  );
}

function NewAppointmentForm({ appointment, customers, defaultDate, initialCustomerId, maxDate, minDate, onClose, onCreate, onUpdate, onGetAvailability, services, staff, staffServices, timezone }: { appointment?: Appointment; customers: Customer[]; defaultDate: string; initialCustomerId: string | null; maxDate: string; minDate: string; onClose: () => void; onCreate: (command: import('./data/types').CreateAppointmentCommand) => Promise<void>; onUpdate?: (command: import('./data/types').UpdateAppointmentCommand) => Promise<void>; onGetAvailability: (command: import('./data/types').AvailabilityCommand) => Promise<import('./data/types').AvailabilitySlot[]>; services: import('./types').BeautyService[]; staff: import('./types').StaffMember[]; staffServices: import('./data/types').StaffServiceAssignment[]; timezone: string }) {
  const [customerId, setCustomerId] = useState(initialCustomerId ?? customers[0]?.id ?? '');
  const initialStaffId = appointment?.staffId ?? staff[0]?.id ?? '';
  const initialEligibleServiceIds = services.filter((service) => staffServices.some((item) => item.staffId === initialStaffId && item.serviceId === service.id && item.active)).map((service) => service.id);
  const [staffId, setStaffId] = useState(initialStaffId);
  const [serviceIds, setServiceIds] = useState<string[]>(appointment?.serviceIds ?? [appointment?.serviceId].filter((id): id is string => Boolean(id)).concat(!appointment && initialEligibleServiceIds.length === 1 ? initialEligibleServiceIds : []));
  const [date, setDate] = useState(defaultDate);
  const [slots, setSlots] = useState<import('./data/types').AvailabilitySlot[]>([]);
  const [startsAt, setStartsAt] = useState(appointment ? localDateTimeToIso(appointment.date, appointment.start, timezone) : '');
  const [notes, setNotes] = useState(appointment?.notes ?? '');
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
      setSlots(await onGetAvailability({ serviceIds, date, staffId, excludeAppointmentId: appointment?.id }));
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
    if (!appointment && !window.confirm(`Crear cita por ${totalPrice} € y ${totalDuration} minutos?`)) return;
    setError('');
    setSaving(true);
    try {
      if (appointment && onUpdate) await onUpdate({ appointmentId: appointment.id, staffId, serviceIds, startsAt, internalNotes: notes });
      else await onCreate({ customerId, staffId, serviceIds, startsAt, customerNotes: notes });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hemos podido crear la cita.');
      setSaving(false);
    }
  }

  const slotLabel = (value: string) => new Intl.DateTimeFormat('es-ES', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  return (
    <Sheet bodyClassName="beauty-sheet__body--appointment" onClose={onClose} subtitle="Disponibilidad real" title={appointment ? 'Editar cita' : 'Nueva cita'} wide>
      <form className="beauty-command-form appointment-create-form" onSubmit={submit}>
        <div className="appointment-create-form__body">
        <label><span>Cliente</span><select disabled={Boolean(appointment)} onChange={(event) => setCustomerId(event.target.value)} value={customerId}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
        {staff.length > 1 ? <div className="form-columns"><label><span>Profesional</span><select onChange={(event) => { const nextStaffId = event.target.value; const nextEligible = services.filter((service) => staffServices.some((item) => item.staffId === nextStaffId && item.serviceId === service.id && item.active)); setStaffId(nextStaffId); setServiceIds(nextEligible.length === 1 ? [nextEligible[0].id] : []); setSlots([]); setStartsAt(''); }} value={staffId}>{staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label><span>Fecha</span><input max={maxDate} min={minDate} onChange={(event) => { setDate(event.target.value); setSlots([]); setStartsAt(''); }} required type="date" value={date} /></label></div> : <><p className="auto-selection-note">{staff[0]?.name} atenderá esta cita.</p><label><span>Fecha</span><input max={maxDate} min={minDate} onChange={(event) => { setDate(event.target.value); setSlots([]); setStartsAt(''); }} required type="date" value={date} /></label></>}
        {eligibleServices.length === 1 ? <div className="single-service-selection"><span><small>Servicio</small><strong>{eligibleServices[0].name}</strong></span><small>{assignments[0]?.durationMinutes} min · {assignments[0]?.price} €</small></div> : <fieldset><legend>Servicios</legend><div className="service-options">{eligibleServices.map((service) => <label key={service.id}><input checked={serviceIds.includes(service.id)} onChange={(event) => { setServiceIds((current) => event.target.checked ? [...current, service.id] : current.filter((id) => id !== service.id)); setSlots([]); setStartsAt(''); }} type="checkbox" /><span><strong>{service.name}</strong><small>{assignments.find((item) => item.serviceId === service.id)?.durationMinutes} min · {assignments.find((item) => item.serviceId === service.id)?.price} €</small></span></label>)}</div></fieldset>}
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
            <button className="form-submit" disabled={saving || !canSubmit} type="submit">{saving ? 'Guardando…' : appointment ? 'Guardar cambios' : 'Confirmar nueva cita'}</button>
          </div>
        </footer>
      </form>
    </Sheet>
  );
}

const conversationLabels: Record<ConversationStatus, string> = {
  ai_handled: 'IA atendiendo',
  waiting_customer: 'Esperando cliente',
  needs_human: 'Necesita atención',
  human_handled: 'Atención manual',
  closed: 'Finalizada',
};

function MessagesPage({ conversations, mode, onOpenConversation }: { conversations: Conversation[]; mode: 'mock' | 'supabase'; onOpenConversation: (id: string) => void }) {
  const urgent = conversations.filter((conversation) => conversation.status === 'needs_human').length;
  if (mode === 'supabase') {
    return (
      <div className="beauty-page">
        <PageHeader eyebrow="WhatsApp inteligente" title="Mensajes" action={<FeatureStateBadge state="soon" />} />
        <section className="future-panel"><MessageCircle size={26} /><span><strong>WhatsApp todavía no está conectado</strong><p>Aquí podrás ver las conversaciones atendidas por la IA y tomar el control cuando una clienta necesite ayuda.</p></span></section>
      </div>
    );
  }
  return (
    <div className="beauty-page">
      <PageHeader eyebrow="WhatsApp inteligente" title="Mensajes" action={<FeatureStateBadge state="demo" />} />
      {urgent > 0 && <div className="attention-banner"><BellRing size={20} /><span><strong>{urgent} conversación necesita atención</strong><small>La IA ha detectado que debe intervenir una persona.</small></span></div>}
      <div className="message-tabs"><button className="is-active" type="button">Todas</button><button type="button">Necesitan atención</button></div>
      {conversations.length === 0 && <div className="empty-state"><MessageCircle /><h2>Aún no hay conversaciones</h2><p>Los mensajes de WhatsApp aparecerán aquí cuando se conecte la recepcionista.</p></div>}
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

function MorePage({ businessName, mode, navigate, progress, serviceCount, staffCount }: { businessName: string; mode: 'mock' | 'supabase'; navigate: (route: BeautyRoute) => void; progress: SetupProgress; serviceCount: number; staffCount: number }) {
  const items = [
    { icon: UsersRound, label: 'Equipo', detail: `${staffCount} profesionales`, route: 'staff' as BeautyRoute, state: mode === 'mock' ? 'demo' as const : undefined },
    { icon: Sparkles, label: 'Servicios', detail: `${serviceCount} servicios`, route: 'services' as BeautyRoute, state: mode === 'mock' ? 'demo' as const : undefined },
    { icon: Clock3, label: 'Horarios', detail: 'Semana habitual y tiempo no disponible', route: 'schedules' as BeautyRoute, state: mode === 'mock' ? 'demo' as const : undefined },
    { icon: Settings2, label: 'Configuración', detail: progress.complete ? 'Negocio configurado' : `${progress.completedCount} de 5 requisitos`, route: 'configuration' as BeautyRoute },
  ];
  return (
    <div className="beauty-page">
      <PageHeader eyebrow="Tu espacio de trabajo" title="Más" />
      <section className="business-card"><BeautyBrandMark size="lg" /><span><strong>{businessName}</strong><small>COSTABOTS Beauty · Sesión protegida</small></span><ShieldCheck size={20} /></section>
      <div className="more-list">
        {items.map(({ icon: Icon, label, detail, route, state }) => <button disabled={!route} key={label} onClick={() => route && navigate(route)} type="button"><span className="more-list__icon"><Icon size={21} /></span><span><strong>{label}</strong><small>{detail}</small></span>{state && <FeatureStateBadge state={state} />}{!route && <FeatureStateBadge state="soon" />}</button>)}
      </div>
      <div className="isolation-note"><ShieldCheck size={20} /><span><strong>{mode === 'mock' ? 'Modo demostración' : 'Conexión segura'}</strong><small>{mode === 'mock' ? 'Datos y acciones locales identificados como demo' : 'Solo están activas las operaciones conectadas y validadas'}</small></span></div>
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
      {rules.length === 0 && <div className="empty-state"><WandSparkles /><h2>No hay automatizaciones</h2><p>Los recordatorios y reactivaciones estarán disponibles próximamente.</p></div>}
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

function AppointmentDetail({ appointment, appointmentServices, customers, onClose, onEdit, onOpenConversation, onStatusChange, readOnly, services, showToast, staff, timezone }: { appointment: Appointment; appointmentServices: import('./data/types').AppointmentService[]; customers: Customer[]; onClose: () => void; onEdit: () => void; onOpenConversation: () => void; onStatusChange: (status: AppointmentStatus) => Promise<void>; readOnly: boolean; services: import('./types').BeautyService[]; showToast: (message: string) => void; staff: import('./types').StaffMember[]; timezone: string }) {
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
    <Sheet onClose={onClose} subtitle={`${formatBusinessDate(appointment.date, timezone, true)} · ${appointment.start}`} title={service.name} wide>
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
        {!readOnly && ['pending', 'confirmed', 'arrived', 'in_service'].includes(appointment.status) && <button onClick={onEdit} type="button">Editar o reprogramar</button>}
        {!readOnly && <button onClick={onOpenConversation} type="button">Abrir conversación</button>}
        {!readOnly && <button onClick={() => showToast('Llamada deshabilitada en el prototipo')} type="button">Llamar</button>}
      </div>{readOnly && !primaryAction && secondaryActions.length === 0 && <div className="read-only-note"><ShieldCheck size={18} /><span><strong>Sin acciones disponibles</strong><small>Este estado no admite cambios desde el Manager.</small></span></div>}</section>
    </Sheet>
  );
}

function CustomerDetail({ canManage, customer, getHistory, mode, onClose, onCreateAppointment, onDeactivate, onEdit, onOpenAppointment, services, staff, timezone, today }: { canManage: boolean; customer: Customer; getHistory: (customerId: string) => Promise<import('./data/types').CustomerHistory>; mode: 'mock' | 'supabase'; onClose: () => void; onCreateAppointment: () => void; onDeactivate: () => Promise<void>; onEdit: () => void; onOpenAppointment: (appointment: Appointment, services: import('./data/types').AppointmentService[]) => void; services: import('./types').BeautyService[]; staff: import('./types').StaffMember[]; timezone: string; today: string }) {
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
      <section><div className="section-heading"><Kicker>Historial completo</Kicker>{history && <span>{customerAppointments.length} citas</span>}</div>{historyError ? <p className="form-error">{historyError}</p> : !history ? <p className="inline-data-message">Cargando historial…</p> : orderedAppointments.length ? <div className="mini-appointment-list">{orderedAppointments.map((appointment) => <button key={appointment.id} onClick={() => onOpenAppointment(appointment, history.appointmentServices.filter((item) => item.appointmentId === appointment.id))} type="button"><span><strong>{findService(services, appointment.serviceId).name}</strong><small>{formatBusinessDate(appointment.date, timezone, true)} · {appointment.start}</small></span><StatusBadge status={appointment.status} /></button>)}</div> : <p className="inline-data-message">Este cliente todavía no tiene citas.</p>}</section>
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
