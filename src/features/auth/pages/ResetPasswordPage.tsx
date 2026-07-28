import { Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { useState } from 'react';
import { AuthShell } from '../components/AuthShell';
import { updatePassword } from '../services/authService';

export function ResetPasswordPage({ onComplete }: { onComplete: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      await updatePassword(password);
      setComplete(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'No hemos podido actualizar la contraseña.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell subtitle="Elige una contraseña segura que no utilices en otros servicios." title="Crea una contraseña nueva">
      {complete ? (
        <div className="auth-success" role="status">
          <LockKeyhole size={28} />
          <strong>Contraseña actualizada</strong>
          <p>Ya puedes continuar a COSTABOTS Beauty.</p>
          <button className="auth-primary-button" onClick={onComplete} type="button">Continuar</button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit}>
          <label><span>Nueva contraseña</span><span className="auth-input"><LockKeyhole size={19} /><input autoComplete="new-password" minLength={8} onChange={(event) => setPassword(event.target.value)} required type={showPassword ? 'text' : 'password'} value={password} /><button aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword((visible) => !visible)} type="button">{showPassword ? <EyeOff /> : <Eye />}</button></span></label>
          <label><span>Repite la contraseña</span><span className="auth-input"><LockKeyhole size={19} /><input autoComplete="new-password" minLength={8} onChange={(event) => setConfirmation(event.target.value)} required type={showPassword ? 'text' : 'password'} value={confirmation} /></span></label>
          {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
          <button className="auth-primary-button" disabled={loading} type="submit">{loading ? 'Guardando…' : 'Guardar contraseña'}</button>
        </form>
      )}
    </AuthShell>
  );
}
