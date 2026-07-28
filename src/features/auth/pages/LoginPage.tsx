import { Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react';
import { useState } from 'react';
import { signInWithPassword } from '../services/authService';
import { AuthShell } from '../components/AuthShell';

export function LoginPage({ onForgotPassword }: { onForgotPassword: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInWithPassword(email, password);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No hemos podido iniciar sesión.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      footer={<>Acceso exclusivo para equipos de negocios COSTABOTS Beauty.</>}
      subtitle="Tu agenda, clientes y recepcionista inteligente en un solo lugar."
      title="Bienvenida de nuevo"
    >
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          <span>Correo electrónico</span>
          <span className="auth-input"><Mail size={19} /><input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></span>
        </label>
        <label>
          <span>Contraseña</span>
          <span className="auth-input"><LockKeyhole size={19} /><input autoComplete="current-password" minLength={6} onChange={(event) => setPassword(event.target.value)} required type={showPassword ? 'text' : 'password'} value={password} /><button aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword((visible) => !visible)} type="button">{showPassword ? <EyeOff /> : <Eye />}</button></span>
        </label>
        {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
        <button className="auth-primary-button" disabled={loading} type="submit">{loading ? 'Iniciando sesión…' : 'Iniciar sesión'}</button>
        <button className="auth-link-button" onClick={onForgotPassword} type="button">¿Has olvidado tu contraseña?</button>
      </form>
    </AuthShell>
  );
}
