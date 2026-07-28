import type { PropsWithChildren } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import type { AuthState } from '../types';

type AuthContextValue = AuthState & {
  recoveryMode: boolean;
  clearRecoveryMode: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const initialState: AuthState = {
  status: 'loading',
  session: null,
  user: null,
  message: null,
};

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>(initialState);
  const [recoveryMode, setRecoveryMode] = useState(
    window.location.pathname === '/auth/reset-password',
  );

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setState({
          status: 'error',
          session: null,
          user: null,
          message: 'No podemos conectar con el servicio de acceso en este momento.',
        });
        return;
      }
      setState(data.session
        ? { status: 'authenticated', session: data.session, user: data.session.user, message: null }
        : { status: 'unauthenticated', session: null, user: null, message: null });
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      setState(session
        ? { status: 'authenticated', session, user: session.user, message: null }
        : { status: 'unauthenticated', session: null, user: null, message: null });
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    recoveryMode,
    clearRecoveryMode: () => setRecoveryMode(false),
  }), [recoveryMode, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe utilizarse dentro de AuthProvider.');
  return value;
}
