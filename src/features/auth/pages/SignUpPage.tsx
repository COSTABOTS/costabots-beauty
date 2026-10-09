import { Eye, EyeOff, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import {
  signUpBeautyAccount,
} from '../services/authService';
import { isValidPassword, PASSWORD_REQUIREMENTS } from '../passwordPolicy';

export function SignUpPage({
  onBack,
  onConfirmationRequired,
}: {
  onBack: () => void;
  onConfirmationRequired: (email: string) => void;
}) {
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedOwnerName = ownerDisplayName.trim();
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedOwnerName.length < 2 || normalizedOwnerName.length > 160) {
      setError('Introduce tu nombre, con un máximo de 160 caracteres.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Introduce un correo electrónico válido.');
      return;
    }
    if (!isValidPassword(password)) {
      setError(PASSWORD_REQUIREMENTS);
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
        email: normalizedEmail,
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
      footer={<button className="auth-link-button" onClick={onBack} type="button">¿Ya tienes cuenta? Iniciar sesión</button>}
      subtitle="Crea tu cuenta y configura tu negocio después de confirmar el correo."
      title="Crear cuenta"
    >
      <form className="auth-form auth-form--signup" onSubmit={handleSubmit}>
        <label><span>Tu nombre</span><span className="auth-input"><UserRound size={19} /><input autoComplete="name" maxLength={160} onChange={(event) => setOwnerDisplayName(event.target.value)} required value={ownerDisplayName} /></span></label>
        <label><span>Correo electrónico</span><span className="auth-input"><Mail size={19} /><input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></span></label>
        <label><span>Contraseña</span><span className="auth-input"><LockKeyhole size={19} /><input autoComplete="new-password" minLength={10} onChange={(event) => setPassword(event.target.value)} required type={showPassword ? 'text' : 'password'} value={password} /><button aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword((visible) => !visible)} type="button">{showPassword ? <EyeOff /> : <Eye />}</button></span><small className="auth-field-help">{PASSWORD_REQUIREMENTS}</small></label>
        <label><span>Confirmar contraseña</span><span className="auth-input"><LockKeyhole size={19} /><input autoComplete="new-password" minLength={10} onChange={(event) => setConfirmation(event.target.value)} required type={showPassword ? 'text' : 'password'} value={confirmation} /></span></label>
        <label className="auth-check"><input checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} type="checkbox" /><span>Acepto los términos de uso y la política de privacidad.</span></label>
        {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
        <button className="auth-primary-button" disabled={loading} type="submit">{loading ? 'Creando cuenta…' : 'Crear cuenta'}</button>
      </form>
    </AuthShell>
  );
}
