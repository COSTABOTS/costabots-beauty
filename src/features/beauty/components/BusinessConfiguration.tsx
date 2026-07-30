import {
  ArrowLeft,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LogOut,
  Scissors,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { resetMockBeautyDemo } from '../data/mockBeautyRepository';
import type { BusinessProfileInput, RepositoryBusiness } from '../data/types';
import { FeatureStateBadge, PageHeader } from './ui';

export type SetupProgress = {
  business: boolean;
  staff: boolean;
  services: boolean;
  assignment: boolean;
  schedule: boolean;
  complete: boolean;
  completedCount: number;
};

const timezones = [
  'Europe/Madrid',
  'Atlantic/Canary',
  'Europe/Lisbon',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Mexico_City',
  'America/Bogota',
  'America/Argentina/Buenos_Aires',
];

function validate(value: BusinessProfileInput) {
  if (!value.name.trim()) return 'El nombre comercial es obligatorio.';
  try {
    new Intl.DateTimeFormat('es-ES', { timeZone: value.timezone }).format();
  } catch {
    return 'Selecciona una zona horaria válida.';
  }
  if (!/^[A-Z]{3}$/.test(value.currency)) return 'La moneda debe ser un código ISO de tres letras.';
  if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) return 'Introduce un email válido.';
  if (value.phone && !/^[+()\d\s.-]{6,30}$/.test(value.phone)) return 'Introduce un teléfono válido.';
  return '';
}

export function BusinessProfileForm({
  business,
  canManage,
  onSave,
}: {
  business: RepositoryBusiness;
  canManage: boolean;
  onSave: (value: BusinessProfileInput) => Promise<string>;
}) {
  const initial = useMemo<BusinessProfileInput>(() => ({
    name: business.name,
    phone: business.phone,
    email: business.email,
    address: business.address,
    timezone: business.timezone,
    currency: business.currency,
  }), [business]);
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => setValue(initial), [initial]);
  const set = <K extends keyof BusinessProfileInput>(key: K, next: BusinessProfileInput[K]) => {
    setSaved(false);
    setValue((current) => ({ ...current, [key]: next }));
  };
  return (
    <form
      className="beauty-command-form business-profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        const message = validate(value);
        setError(message);
        if (message) return;
        setSaving(true);
        void onSave({ ...value, name: value.name.trim(), currency: value.currency.toUpperCase() })
          .then(() => setSaved(true))
          .catch((cause) => setError(cause instanceof Error ? cause.message : 'No hemos podido guardar el negocio.'))
          .finally(() => setSaving(false));
      }}
    >
      <label><span>Nombre comercial *</span><input disabled={!canManage} maxLength={160} onChange={(event) => set('name', event.target.value)} required value={value.name} /></label>
      <div className="form-columns">
        <label><span>Teléfono</span><input disabled={!canManage} inputMode="tel" onChange={(event) => set('phone', event.target.value)} value={value.phone} /></label>
        <label><span>Email</span><input disabled={!canManage} onChange={(event) => set('email', event.target.value)} type="email" value={value.email} /></label>
      </div>
      <label><span>Dirección (opcional)</span><input disabled={!canManage} maxLength={300} onChange={(event) => set('address', event.target.value)} value={value.address} /></label>
      <div className="form-columns">
        <label><span>Zona horaria *</span><select disabled={!canManage} onChange={(event) => set('timezone', event.target.value)} value={value.timezone}>{timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}</select></label>
        <label><span>Moneda *</span><input disabled={!canManage} maxLength={3} onChange={(event) => set('currency', event.target.value.toUpperCase())} value={value.currency} /></label>
      </div>
      {!canManage && <p className="form-help">Tu rol permite consultar estos datos, pero solo owner y admin pueden modificarlos.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {saved && <p className="form-success"><Check size={16} />Datos guardados</p>}
      <button className="form-submit" disabled={!canManage || saving} type="submit">{saving ? 'Guardando…' : 'Guardar datos del negocio'}</button>
    </form>
  );
}

export function ConfigurationPage({
  business,
  canManage,
  mode,
  onBack,
  onOpenOnboarding,
  onSave,
  onSignOut,
  progress,
}: {
  business: RepositoryBusiness;
  canManage: boolean;
  mode: 'mock' | 'supabase';
  onBack: () => void;
  onOpenOnboarding: () => void;
  onSave: (value: BusinessProfileInput) => Promise<string>;
  onSignOut: () => void;
  progress: SetupProgress;
}) {
  return <div className="beauty-page configuration-page">
    <PageHeader eyebrow="Preferencias esenciales" title="Configuración" action={<div className="heading-actions">{mode === 'mock' && <FeatureStateBadge state="demo" />}<button aria-label="Volver" className="icon-button-soft" onClick={onBack} type="button"><ArrowLeft /></button></div>} />
    <section className="setup-status-card">
      <span><strong>{progress.complete ? 'Negocio configurado' : 'Configuración pendiente'}</strong><small>{progress.completedCount} de 5 requisitos completados</small></span>
      <button onClick={onOpenOnboarding} type="button">{progress.complete ? 'Revisar onboarding' : 'Continuar onboarding'}</button>
    </section>
    <section className="configuration-section"><h2>Datos del negocio</h2><p>Información visible y valores usados por la agenda.</p><BusinessProfileForm business={business} canManage={canManage} onSave={onSave} /></section>
    {mode === 'mock' && <section className="configuration-section configuration-section--reset"><h2>Demostración</h2><p>Restaura los datos ficticios iniciales y elimina únicamente los cambios guardados en este navegador.</p><button className="danger-inline" onClick={() => { if (window.confirm('¿Reiniciar la demostración y descartar los cambios guardados en este navegador?')) resetMockBeautyDemo(); }} type="button">Reiniciar demostración</button></section>}
    <section className="configuration-section configuration-section--account">
      <h2>Cuenta</h2>
      <p>Cierra el acceso en este dispositivo sin modificar los datos del negocio.</p>
      <button
        className="beauty-signout"
        onClick={() => {
          if (window.confirm('¿Quieres cerrar sesión?')) onSignOut();
        }}
        type="button"
      >
        <LogOut size={19} />
        Cerrar sesión
      </button>
    </section>
  </div>;
}

const steps = [
  { title: 'Negocio', text: 'Revisa el nombre, zona horaria y moneda.', icon: BriefcaseBusiness },
  { title: 'Profesional', text: 'Añade a la primera persona que atenderá citas.', icon: UserRound },
  { title: 'Servicios', text: 'Crea al menos un servicio y asígnalo a un profesional.', icon: Scissors },
  { title: 'Horario', text: 'Define al menos un tramo habitual de disponibilidad.', icon: Clock3 },
  { title: 'Finalización', text: 'Comprueba que el negocio está preparado.', icon: Sparkles },
];

export function OnboardingPage({
  business,
  canManage,
  mode,
  onBack,
  onOpenSchedules,
  onOpenServices,
  onOpenStaff,
  onSaveBusiness,
  progress,
}: {
  business: RepositoryBusiness;
  canManage: boolean;
  mode: 'mock' | 'supabase';
  onBack: () => void;
  onOpenSchedules: () => void;
  onOpenServices: () => void;
  onOpenStaff: () => void;
  onSaveBusiness: (value: BusinessProfileInput) => Promise<string>;
  progress: SetupProgress;
}) {
  const firstIncomplete = !progress.business ? 0 : !progress.staff ? 1 : (!progress.services || !progress.assignment) ? 2 : !progress.schedule ? 3 : 4;
  const [step, setStep] = useState(firstIncomplete);
  useEffect(() => {
    if (!progress.complete && step < firstIncomplete) setStep(firstIncomplete);
  }, [firstIncomplete, progress.complete, step]);
  const current = steps[step];
  const CurrentIcon = current.icon;
  const stepComplete = [progress.business, progress.staff, progress.services && progress.assignment, progress.schedule, progress.complete][step];
  return <div className="beauty-page onboarding-page">
    <PageHeader eyebrow="Puesta en marcha" title="Configura tu negocio" action={<div className="heading-actions">{mode === 'mock' && <FeatureStateBadge state="demo" />}<button aria-label="Cerrar onboarding" className="icon-button-soft" onClick={onBack} type="button"><ArrowLeft /></button></div>} />
    <div className="onboarding-progress" aria-label={`Paso ${step + 1} de 5`}><span style={{ width: `${((step + 1) / 5) * 100}%` }} /></div>
    <p className="onboarding-step-label">Paso {step + 1} de 5</p>
    <section className="onboarding-card">
      <span className="onboarding-card__icon"><CurrentIcon /></span>
      <div><h2>{current.title}</h2><p>{current.text}</p></div>
      {stepComplete && <span className="setup-complete-badge"><Check size={15} />Completo</span>}
    </section>
    {step === 0 && <BusinessProfileForm business={business} canManage={canManage} onSave={onSaveBusiness} />}
    {step === 1 && <div className="onboarding-action"><p>{progress.staff ? 'Ya existe al menos un profesional activo.' : 'Crea el primer profesional con el formulario habitual.'}</p><button disabled={!canManage} onClick={onOpenStaff} type="button">{progress.staff ? 'Revisar profesionales' : 'Crear profesional'}</button></div>}
    {step === 2 && <div className="onboarding-action"><p>{progress.services ? 'Ya existe un servicio activo.' : 'Crea un servicio reservable. Con uno es suficiente para empezar.'}</p><button disabled={!canManage} onClick={onOpenServices} type="button">{progress.services ? 'Revisar servicios' : 'Crear servicio'}</button><button className="secondary-action" disabled={!canManage} onClick={onOpenStaff} type="button">{progress.assignment ? 'Asignación completada' : 'Asignar a un profesional'}</button><button className="soon-action" disabled type="button">Importar catálogo con IA <FeatureStateBadge state="soon" /></button><small>Sube una foto o PDF de tu tarifa y revisa los servicios antes de importarlos.</small></div>}
    {step === 3 && <div className="onboarding-action"><p>{progress.schedule ? 'Ya existe un tramo horario activo.' : 'Configura cuándo puede recibir citas cada profesional.'}</p><button disabled={!canManage || !progress.staff} onClick={onOpenSchedules} type="button">{progress.schedule ? 'Revisar horario' : 'Configurar horario'}</button></div>}
    {step === 4 && <div className={`onboarding-finish ${progress.complete ? 'is-complete' : ''}`}><Sparkles /><h2>{progress.complete ? 'Todo preparado' : 'Aún faltan algunos pasos'}</h2><p>{progress.complete ? 'Ya puedes gestionar disponibilidad y citas.' : `Has completado ${progress.completedCount} de 5 requisitos. Vuelve al primer paso pendiente.`}</p></div>}
    <div className="onboarding-navigation">
      <button disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))} type="button"><ChevronLeft />Anterior</button>
      {step < 4 ? <button disabled={!stepComplete} onClick={() => setStep((value) => Math.min(4, value + 1))} type="button">Siguiente<ChevronRight /></button> : <button onClick={onBack} type="button">{progress.complete ? 'Ir al Manager' : 'Continuar después'}</button>}
    </div>
  </div>;
}
