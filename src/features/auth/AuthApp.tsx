import { useState } from 'react';
import { AuthProvider, useAuth } from './hooks/AuthProvider';
import { MembershipGate } from './components/MembershipGate';
import { AuthLoading, AuthNotice } from './components/AuthShell';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import './auth.css';

type PublicScreen = 'login' | 'forgot-password';

function AuthRouter() {
  const auth = useAuth();
  const [screen, setScreen] = useState<PublicScreen>('login');

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
    return screen === 'forgot-password'
      ? <ForgotPasswordPage onBack={() => setScreen('login')} />
      : <LoginPage onForgotPassword={() => setScreen('forgot-password')} />;
  }

  return <MembershipGate />;
}

export function AuthApp() {
  return <AuthProvider><AuthRouter /></AuthProvider>;
}
