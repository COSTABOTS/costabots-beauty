import { Building2, Phone } from 'lucide-react';
import { useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import type { BeautyBusinessProvisioningInput } from '../services/authService';
import {
  beautyBusinessTypeLabels,
  beautyBusinessTypes,
  type BeautyBusinessType,
} from '../../beauty/data/businessProfile';

export function BusinessSetupPage({
  onComplete,
  onSignOut,
}: {
  onComplete: (input: BeautyBusinessProvisioningInput) => Promise<void>;
  onSignOut: () => void;
}) {
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState<BeautyBusinessType | ''>('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = businessName.trim();
    const phoneDigits = businessPhone.replace(/\D/g, '');
    if (name.length < 2 || name.length > 160) {
      setError('Introduce el nombre del negocio, con un máximo de 160 caracteres.');
      return;
    }
    if (!businessType) {
      setError('Selecciona tu tipo de negocio.');
      return;
    }
    if (phoneDigits.length < 8 || phoneDigits.length > 15) {
      setError('Introduce un teléfono válido.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      await onComplete({ businessName: name, businessType, businessPhone: businessPhone.trim() });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hemos podido preparar tu espacio.');
      setLoading(false);
    }
  }

  return (
    <AuthShell
      footer={<button className="auth-link-button" onClick={onSignOut} type="button">Cerrar sesión</button>}
      subtitle="Este es el primer paso para preparar tu agenda."
      title="Configura tu negocio"
    >
      <form className="auth-form auth-form--signup" onSubmit={handleSubmit}>
        <label><span>Nombre del negocio</span><span className="auth-input"><Building2 size={19} /><input autoComplete="organization" maxLength={160} onChange={(event) => setBusinessName(event.target.value)} required value={businessName} /></span></label>
        <label><span>Tipo de negocio</span><select className="auth-select" onChange={(event) => setBusinessType(event.target.value as BeautyBusinessType | '')} required value={businessType}><option disabled value="">Selecciona tu tipo de negocio</option>{beautyBusinessTypes.map((type) => <option key={type} value={type}>{beautyBusinessTypeLabels[type]}</option>)}</select></label>
        <label><span>Teléfono del negocio</span><span className="auth-input"><Phone size={19} /><input autoComplete="tel" inputMode="tel" onChange={(event) => setBusinessPhone(event.target.value)} placeholder="+34 600 000 000" required type="tel" value={businessPhone} /></span></label>
        {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
        <button className="auth-primary-button" disabled={loading} type="submit">{loading ? 'Preparando tu espacio…' : 'Continuar'}</button>
      </form>
    </AuthShell>
  );
}
