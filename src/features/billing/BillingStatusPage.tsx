import type { BillingAccess } from './types';

export function BillingStatusPage({ access, busy, onCheckout, onPortal, onRefresh }: {
  access: BillingAccess;
  busy: boolean;
  onCheckout: () => void;
  onPortal: () => void;
  onRefresh: () => void;
}) {
  const inGrace = access.state === 'grace';
  const pending = access.state === 'pending_confirmation';
  const title = pending ? 'Confirmando tu pago' : inGrace ? 'Tu pago necesita atención' : access.state === 'suspended' ? 'Tu acceso está suspendido' : 'Activa AURA';
  const detail = pending
    ? 'Estamos esperando la confirmación segura de tu pago.'
    : inGrace
      ? `Conservas el acceso hasta ${access.graceEndsAt ? new Date(access.graceEndsAt).toLocaleDateString('es-ES') : 'resolver el pago'}.`
      : access.state === 'suspended'
        ? 'Actualiza el método de pago para recuperar tu acceso. Tus datos siguen guardados.'
        : 'Completa la suscripción para continuar con la configuración de AURA.';
  return (
    <main className="billing-shell"><section className="billing-card"><p className="billing-kicker">AURA · Suscripción TEST</p><h1>{title}</h1><p>{detail}</p><div className="billing-actions">
      {access.canManageBilling && access.state === 'requires_payment' && <button className="auth-primary-button" disabled={busy} onClick={onCheckout} type="button">Continuar al pago</button>}
      {access.canManageBilling && (access.state === 'grace' || access.state === 'suspended' || access.state === 'active') && <button className="auth-primary-button" disabled={busy} onClick={onPortal} type="button">Gestionar suscripción</button>}
      <button className="auth-link-button" disabled={busy} onClick={onRefresh} type="button">Actualizar estado</button>
    </div></section></main>
  );
}
