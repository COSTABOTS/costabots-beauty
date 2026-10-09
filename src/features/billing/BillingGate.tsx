import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { useBeautyBusiness } from '../beauty/context/BeautyBusinessProvider';
import { AuthLoading } from '../auth/components/AuthShell';
import { createCheckout, loadBillingAccess, openCustomerPortal } from './billingService';
import { BillingStatusPage } from './BillingStatusPage';
import { shouldBlockOnBillingLookupError } from './billingRules';
import type { BillingAccess } from './types';
import { beautyEnvironment } from '../../config/environment';
import './billing.css';

export function BillingGate({ children }: PropsWithChildren) {
  const membership = useBeautyBusiness();
  const [access, setAccess] = useState<BillingAccess | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [knownTestSubject, setKnownTestSubject] = useState(() => beautyEnvironment.billingTestSubjectBusinessIds.includes(membership.business.id));
  useEffect(() => {
    setAccess(null);
    setError('');
    setKnownTestSubject(beautyEnvironment.billingTestSubjectBusinessIds.includes(membership.business.id));
  }, [membership.business.id]);
  const refresh = useCallback(async () => {
    setError('');
    try {
      const next = await loadBillingAccess(membership.business.id);
      setAccess(next);
      setKnownTestSubject(next.subjectEnrolled);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'No hemos podido comprobar el pago.'); }
  }, [membership.business.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  if (!access && !error) return <AuthLoading label="Comprobando la suscripción…" />;
  if (error && shouldBlockOnBillingLookupError(knownTestSubject)) return <main className="billing-shell"><section className="billing-card"><h1>No podemos comprobar el pago</h1><p>{error}</p><button className="auth-primary-button" onClick={() => void refresh()} type="button">Volver a intentar</button></section></main>;
  if (error) return <>{children}</>;
  const redirect = async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      window.location.assign(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No hemos podido continuar.');
      setBusy(false);
    }
  };
  if (!access || !access.subjectEnrolled) return <>{children}</>;
  if (access.allowed) {
    return <><BillingBanner access={access} busy={busy} onPortal={() => void redirect(() => openCustomerPortal(membership.business.id))} />{children}</>;
  }
  return <BillingStatusPage access={access} busy={busy} onCheckout={() => void redirect(() => createCheckout(membership.business.id))} onPortal={() => void redirect(() => openCustomerPortal(membership.business.id))} onRefresh={() => void refresh()} />;
}

function BillingBanner({ access, busy, onPortal }: { access: BillingAccess; busy: boolean; onPortal: () => void }) {
  if (!access.canManageBilling && access.state !== 'grace') return null;
  return <aside className={`billing-banner ${access.state === 'grace' ? 'billing-banner--warning' : ''}`} role={access.state === 'grace' ? 'status' : undefined}>
    <span>{access.state === 'grace' ? 'Tu pago necesita atención. Conservas el acceso temporalmente.' : 'Suscripción TEST activa.'}</span>
    {access.canManageBilling && <button className="auth-link-button" disabled={busy} onClick={onPortal} type="button">Gestionar suscripción</button>}
  </aside>;
}
