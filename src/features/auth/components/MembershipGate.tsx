import { useEffect, useState } from 'react';
import { BeautyApp } from '../../beauty/BeautyApp';
import { BeautyBusinessProvider } from '../../beauty/context/BeautyBusinessProvider';
import { useAuth } from '../hooks/AuthProvider';
import { loadActiveMemberships, signOut } from '../services/authService';
import type { BeautyMembership } from '../types';
import { AuthLoading, AuthNotice } from './AuthShell';

type MembershipState =
  | { status: 'loading'; memberships: []; selected: null; message: null }
  | { status: 'ready'; memberships: BeautyMembership[]; selected: BeautyMembership | null; message: null }
  | { status: 'error'; memberships: []; selected: null; message: string };

export function MembershipGate() {
  const auth = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MembershipState>({
    status: 'loading',
    memberships: [],
    selected: null,
    message: null,
  });

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    let active = true;
    setState({ status: 'loading', memberships: [], selected: null, message: null });

    void loadActiveMemberships(auth.user.id)
      .then((memberships) => {
        if (!active) return;
        setState({
          status: 'ready',
          memberships,
          selected: memberships.length === 1 ? memberships[0] : null,
          message: null,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'error',
          memberships: [],
          selected: null,
          message: error instanceof Error ? error.message : 'No hemos podido comprobar tu acceso.',
        });
      });

    return () => {
      active = false;
    };
  }, [attempt, auth.status, auth.status === 'authenticated' ? auth.user.id : null]);

  if (state.status === 'loading') return <AuthLoading label="Comprobando tu negocio…" />;

  if (state.status === 'error') {
    return (
      <AuthNotice
        action={<><button className="auth-primary-button" onClick={() => setAttempt((value) => value + 1)} type="button">Volver a intentar</button><button className="auth-link-button" onClick={() => void signOut()} type="button">Cerrar sesión</button></>}
        detail={state.message}
        title="No podemos cargar tu acceso"
      />
    );
  }

  if (state.memberships.length === 0) {
    return (
      <AuthNotice
        action={<button className="auth-primary-button" onClick={() => void signOut()} type="button">Cerrar sesión</button>}
        detail="Pide al administrador del negocio que revise tu invitación o membresía."
        title="No tienes acceso a ningún negocio de COSTABOTS Beauty."
      />
    );
  }

  if (!state.selected) {
    return (
      <AuthNotice detail="Tu cuenta pertenece a más de un negocio. Elige con cuál quieres trabajar." title="Selecciona un negocio">
        <div className="business-selector">
          {state.memberships.map((membership) => (
            <button key={membership.id} onClick={() => setState({ ...state, selected: membership })} type="button">
              <strong>{membership.business.name}</strong>
              <small>{membership.role}</small>
            </button>
          ))}
        </div>
      </AuthNotice>
    );
  }

  return (
    <BeautyBusinessProvider membership={state.selected}>
      <BeautyApp />
    </BeautyBusinessProvider>
  );
}
