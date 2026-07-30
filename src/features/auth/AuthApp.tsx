import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/AuthProvider';
import { MembershipGate } from './components/MembershipGate';
import { AuthLoading, AuthNotice } from './components/AuthShell';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SignUpPage } from './pages/SignUpPage';
import { ConfirmEmailPage } from './pages/ConfirmEmailPage';
import { beautyEnvironment } from '../../config/environment';
import './auth.css';

type PublicScreen = 'login' | 'forgot-password' | 'signup' | 'confirm-email';

function AuthRouter() {
  const auth = useAuth();
  const [screen, setScreen] = useState<PublicScreen>('login');
  const [pendingEmail, setPendingEmail] = useState('');

  if (auth.status === 'loading') return <AuthLoading />;

  if (auth.status === 'error') {
    return <AuthNotice detail={auth.message} title="Servicio temporalmente no disponible" />;
  }

  if (auth.recoveryMode) {
    return (
      <ResetPasswordPage
        onComplete={() => {
          auth.clearRecoveryMode();
          window.history.replaceState({}, '', '/');
        }}
      />
    );
  }

  if (auth.status === 'unauthenticated') {
    if (screen === 'forgot-password') return <ForgotPasswordPage onBack={() => setScreen('login')} />;
    if (screen === 'signup' && beautyEnvironment.publicSignupEnabled) {
      return <SignUpPage onBack={() => setScreen('login')} onConfirmationRequired={(email) => { setPendingEmail(email); setScreen('confirm-email'); }} />;
    }
    if (screen === 'confirm-email' && pendingEmail && beautyEnvironment.publicSignupEnabled) {
      return <ConfirmEmailPage email={pendingEmail} onBack={() => setScreen('login')} />;
    }
    return <LoginPage onForgotPassword={() => setScreen('forgot-password')} onSignUp={beautyEnvironment.publicSignupEnabled ? () => setScreen('signup') : undefined} />;
  }

  return <MembershipGate />;
}

export function AuthApp() {
  return <AuthProvider><AuthRouter /></AuthProvider>;
}
