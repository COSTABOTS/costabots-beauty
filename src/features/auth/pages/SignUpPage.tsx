import { Building2, Eye, EyeOff, LockKeyhole, Mail, Phone, UserRound } from 'lucide-react';
import { useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import {
  signUpBeautyAccount,
  type BeautyBusinessType,
} from '../services/authService';

const businessTypes: Array<{ value: BeautyBusinessType; label: string }> = [
  { value: 'nail_salon', label: 'Salón de uñas' },
  { value: 'hair_salon', label: 'Peluquería' },
  { value: 'beauty_center', label: 'Centro de estética' },
  { value: 'other', label: 'Otro' },
];

export function SignUpPage({
  onBack,
  onConfirmationRequired,
}: {
  onBack: () => void;
  onConfirmationRequired: (email: string) => void;
}) {
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState<BeautyBusinessType>('nail_salon');
  const [email, setEmail] = useState('');
  const [businessPhone, setBusinessPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedOwnerName = ownerDisplayName.trim();
    const normalizedBusinessName = businessName.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const phoneDigits = businessPhone.replace(/\D/g, '');
    if (normalizedOwnerName.length < 2 || normalizedOwnerName.length > 160) {
      setError('Introduce tu nombre, con un máximo de 160 caracteres.');
      return;
    }
    if (normalizedBusinessName.length < 2 || normalizedBusinessName.length > 160) {
      setError('Introduce el nombre del negocio, con un máximo de 160 caracteres.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Introduce un correo electrónico válido.');
      return;
    }
    if (phoneDigits.length < 8 || phoneDigits.length > 15) {
      setError('Introduce un teléfono válido.');
      return;
    }
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('Usa al menos 10 caracteres e incluye letras y números.');
      return;
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    if (!acceptedTerms) {
      setError('Debes aceptar los términos y la política de privacidad.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await signUpBeautyAccount({
        ownerDisplayName: normalizedOwnerName,
        businessName: normalizedBusinessName,
        businessType,
        email: normalizedEmail,
        businessPhone: businessPhone.trim(),
        password,
      });
      onConfirmationRequired(result.email);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hemos podido crear la cuenta.');
      setLoading(false);
    }
  }

  return (
    <AuthShell
      footer={<button className="auth-link-button" onClick={onBack} type="button">Ya tengo cuenta · Iniciar sesión</button>}
      subtitle="Crea tu espacio y termina la configuración después de confirmar el correo."
      title="Crear cuenta"
    >
      <form className="auth-form auth-form--signup" onSubmit={handleSubmit}>
        <label><span>Tu nombre</span><span className="auth-input"><UserRound size={19} /><input autoComplete="name" maxLength={160} onChange={(event) => setOwnerDisplayName(event.target.value)} required value={ownerDisplayName} /></span></label>
        <label><span>Nombre del negocio</span><span className="auth-input"><Building2 size={19} /><input maxLength={160} onChange={(event) => setBusinessName(event.target.value)} required value={businessName} /></span></label>
        <label><span>Tipo de negocio</span><select className="auth-select" onChange={(event) => setBusinessType(event.target.value as BeautyBusinessType)} value={businessType}>{businessTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
        <label><span>Correo electrónico</span><span className="auth-input"><Mail size={19} /><input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></span></label>
        <label><span>Teléfono del negocio</span><span className="auth-input"><Phone size={19} /><input autoComplete="tel" inputMode="tel" onChange={(event) => setBusinessPhone(event.target.value)} placeholder="+34 600 000 000" required type="tel" value={businessPhone} /></span></label>
        <label><span>Contraseña</span><span className="auth-input"><LockKeyhole size={19} /><input autoComplete="new-password" minLength={10} onChange={(event) => setPassword(event.target.value)} required type={showPassword ? 'text' : 'password'} value={password} /><button aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword((visible) => !visible)} type="button">{showPassword ? <EyeOff /> : <Eye />}</button></span><small className="auth-field-help">Mínimo 10 caracteres, con letras y números.</small></label>
        <label><span>Confirmar contraseña</span><span className="auth-input"><LockKeyhole size={19} /><input autoComplete="new-password" minLength={10} onChange={(event) => setConfirmation(event.target.value)} required type={showPassword ? 'text' : 'password'} value={confirmation} /></span></label>
        <label className="auth-check"><input checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} type="checkbox" /><span>Acepto los términos de uso y la política de privacidad.</span></label>
        {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
        <button className="auth-primary-button" disabled={loading} type="submit">{loading ? 'Creando cuenta…' : 'Crear cuenta'}</button>
      </form>
    </AuthShell>
  );
}
