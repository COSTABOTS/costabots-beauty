import { MailCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import { resendSignUpConfirmation } from '../services/authService';

function maskEmail(email: string) {
  const [name, domain] = email.split('@');
  if (!domain) return email;
  const visible = name.slice(0, Math.min(2, name.length));
  return `${visible}${'*'.repeat(Math.max(2, name.length - visible.length))}@${domain}`;
}

export function ConfirmEmailPage({ email, onBack }: { email: string; onBack: () => void }) {
  const [cooldown, setCooldown] = useState(60);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  async function resend() {
    setError('');
    setMessage('');
    try {
      await resendSignUpConfirmation(email);
      setCooldown(60);
      setMessage('Te hemos enviado un correo nuevo.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hemos podido reenviar el correo.');
    }
  }

  return (
    <AuthShell
      subtitle="Necesitamos confirmar que el correo te pertenece antes de preparar el negocio."
      title="Revisa tu correo"
    >
      <div className="auth-success auth-confirmation">
        <MailCheck size={38} />
        <p>Hemos enviado el enlace de confirmación a <strong>{maskEmail(email)}</strong>.</p>
        <p>Después de confirmarlo, vuelve aquí e inicia sesión.</p>
        {message && <p className="auth-message auth-message--success" role="status">{message}</p>}
        {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
        <button className="auth-primary-button" onClick={onBack} type="button">Volver a iniciar sesión</button>
        <button className="auth-link-button" disabled={cooldown > 0} onClick={() => void resend()} type="button">{cooldown > 0 ? `Reenviar en ${cooldown}s` : 'Reenviar correo de confirmación'}</button>
      </div>
    </AuthShell>
  );
}
