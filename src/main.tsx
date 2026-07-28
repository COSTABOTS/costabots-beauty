import React from 'react';
import ReactDOM from 'react-dom/client';

const shouldResetLocalSession = new URLSearchParams(window.location.search).has('reset');

if (shouldResetLocalSession) {
  sessionStorage.removeItem('costabots_beauty_logged_in');
  sessionStorage.removeItem('costabots_beauty_client_config');
  localStorage.removeItem('costabots_beauty_legacy_settings');
  localStorage.removeItem('costabots_beauty_legacy_date_booking_status');
  window.history.replaceState({}, document.title, window.location.pathname);
}

const root = ReactDOM.createRoot(document.getElementById('root')!);

void import('./features/auth/AuthApp')
  .then(({ AuthApp }) => {
    root.render(<React.StrictMode><AuthApp /></React.StrictMode>);
  })
  .catch(() => {
    root.render(
      <React.StrictMode>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f7f3ee', color: '#292724', fontFamily: 'system-ui' }}>
          <section style={{ width: '100%', maxWidth: 460, padding: 28, borderRadius: 24, background: '#fffdfb' }}>
            <strong>COSTABOTS Beauty</strong>
            <h1>Configuración no válida</h1>
            <p>La aplicación se ha bloqueado de forma segura. Revisa las variables de entorno de Beauty.</p>
          </section>
        </main>
      </React.StrictMode>,
    );
  });

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.info('[COSTABOTS Beauty] Service worker registration skipped:', error);
    });
  });
}

if ('serviceWorker' in navigator && import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    });

    caches.keys().then((keys) => {
      keys.forEach((key) => caches.delete(key));
    });
  });
}
