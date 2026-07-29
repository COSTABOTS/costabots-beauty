import { useState } from 'react';
import type { CustomerInput } from '../data/types';
import type { Customer, StaffMember } from '../types';
import { Sheet } from './ui';

type CustomerFormValue = CustomerInput & { active: boolean };

export function CustomerForm({
  customer,
  mode,
  onClose,
  onSave,
  staff,
}: {
  customer?: Customer;
  mode: 'mock' | 'supabase';
  onClose: () => void;
  onSave: (value: CustomerFormValue) => Promise<void>;
  staff: StaffMember[];
}) {
  const [firstName, setFirstName] = useState(customer?.firstName ?? customer?.name.split(' ')[0] ?? '');
  const [lastName, setLastName] = useState(customer?.lastName ?? customer?.name.split(' ').slice(1).join(' ') ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [preferredStaffId, setPreferredStaffId] = useState(customer?.preferredStaffId ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [reminderConsent, setReminderConsent] = useState(customer?.reminderConsent ?? customer?.messagingConsent ?? false);
  const [marketingConsent, setMarketingConsent] = useState(customer?.marketingConsent ?? false);
  const [active, setActive] = useState(customer?.active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = firstName.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim();
    if (!cleanName) {
      setError('El nombre es obligatorio.');
      return;
    }
    if (cleanPhone.replace(/\D/g, '').length < 8) {
      setError('Introduce un teléfono válido.');
      return;
    }
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Introduce un email válido.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await onSave({
        firstName: cleanName,
        lastName: lastName.trim(),
        phone: cleanPhone,
        email: cleanEmail,
        preferredStaffId: preferredStaffId || null,
        notes: notes.trim(),
        reminderConsent,
        marketingConsent,
        active,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hemos podido guardar el cliente.');
      setSaving(false);
    }
  }

  return (
    <Sheet
      onClose={onClose}
      subtitle={`${customer ? 'Editar cliente' : 'Nuevo cliente'}${mode === 'mock' ? ' · Demo' : ''}`}
      title={customer?.name ?? 'Crear cliente'}
      wide
    >
      <form className="beauty-command-form customer-form" onSubmit={submit}>
        <div className="form-columns">
          <label><span>Nombre *</span><input autoComplete="given-name" maxLength={120} onChange={(event) => setFirstName(event.target.value)} required value={firstName} /></label>
          <label><span>Apellidos</span><input autoComplete="family-name" maxLength={160} onChange={(event) => setLastName(event.target.value)} value={lastName} /></label>
        </div>
        <div className="form-columns">
          <label><span>Teléfono *</span><input autoComplete="tel" inputMode="tel" onChange={(event) => setPhone(event.target.value)} placeholder="+34 600 000 000" required value={phone} /></label>
          <label><span>Email</span><input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} type="email" value={email} /></label>
        </div>
        <label>
          <span>Profesional preferido</span>
          <select onChange={(event) => setPreferredStaffId(event.target.value)} value={preferredStaffId}>
            <option value="">Sin preferencia</option>
            {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <label><span>Notas internas</span><textarea maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="No incluyas información médica o especialmente sensible." value={notes} /></label>
        <fieldset className="consent-options">
          <legend>Consentimientos</legend>
          <label><input checked={reminderConsent} onChange={(event) => setReminderConsent(event.target.checked)} type="checkbox" /><span><strong>Recordatorios de citas</strong><small>Permite enviar confirmaciones y recordatorios cuando se conecte WhatsApp.</small></span></label>
          <label><input checked={marketingConsent} onChange={(event) => setMarketingConsent(event.target.checked)} type="checkbox" /><span><strong>Comunicaciones comerciales</strong><small>Consentimiento independiente para promociones futuras.</small></span></label>
        </fieldset>
        {customer && <label className="customer-active-control"><input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" /><span>Cliente activo</span></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="form-submit" disabled={saving} type="submit">{saving ? 'Guardando…' : customer ? 'Guardar cambios' : 'Crear cliente'}</button>
      </form>
    </Sheet>
  );
}
