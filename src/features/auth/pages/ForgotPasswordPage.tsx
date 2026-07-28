import { ArrowLeft, Mail } from 'lucide-react';
import { useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import { requestPasswordReset } from '../services/authService';

export function ForgotPasswordPage({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No hemos podido procesar la solicitud.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell subtitle="Te enviaremos instrucciones para crear una contraseña nueva." title="Recupera tu acceso">
      {sent ? (
        <div className="auth-success" role="status">
          <Mail size={28} />
          <strong>Solicitud procesada</strong>
          <p>Si la cuenta puede recibir un enlace de recuperación, llegará en unos minutos.</p>
          <button className="auth-primary-button" onClick={onBack} type="button">Volver al inicio</button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            <span>Correo electrónico</span>
            <span className="auth-input"><Mail size={19} /><input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></span>
          </label>
          {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
          <button className="auth-primary-button" disabled={loading} type="submit">{loading ? 'Procesando…' : 'Enviar enlace'}</button>
          <button className="auth-link-button" onClick={onBack} type="button"><ArrowLeft size={16} />Volver al login</button>
        </form>
      )}
    </AuthShell>
  );
}
