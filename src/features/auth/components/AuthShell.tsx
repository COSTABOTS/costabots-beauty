import type { PropsWithChildren, ReactNode } from 'react';

export function AuthShell({
  children,
  footer,
  subtitle,
  title,
}: PropsWithChildren<{ footer?: ReactNode; subtitle: string; title: string }>) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand" aria-label="COSTABOTS Beauty">
          <span className="auth-brand__mark">B</span>
          <span><strong>COSTABOTS</strong><small>BEAUTY</small></span>
        </div>
        <header className="auth-heading">
          <h1 id="auth-title">{title}</h1>
          <p>{subtitle}</p>
        </header>
        {children}
        {footer && <footer className="auth-footer">{footer}</footer>}
      </section>
    </main>
  );
}

export function AuthLoading({ label = 'Comprobando tu sesión…' }: { label?: string }) {
  return (
    <main className="auth-shell">
      <div className="auth-loading" role="status">
        <span className="auth-spinner" />
        <strong>{label}</strong>
        <small>Tu acceso se valida de forma segura.</small>
      </div>
    </main>
  );
}

export function AuthNotice({
  action,
  children,
  detail,
  title,
}: PropsWithChildren<{
  action?: ReactNode;
  detail: string;
  title: string;
}>) {
  return (
    <AuthShell subtitle={detail} title={title}>
      {action && <div className="auth-notice-action">{action}</div>}
      {children}
    </AuthShell>
  );
}
