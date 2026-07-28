import React from 'react';
import ReactDOM from 'react-dom/client';
import { BeautyApp } from './features/beauty/BeautyApp';

const shouldResetLocalSession = new URLSearchParams(window.location.search).has('reset');

if (shouldResetLocalSession) {
  sessionStorage.removeItem('costabots_beauty_logged_in');
  sessionStorage.removeItem('costabots_beauty_client_config');
  localStorage.removeItem('costabots_beauty_legacy_settings');
  localStorage.removeItem('costabots_beauty_legacy_date_booking_status');
  window.history.replaceState({}, document.title, window.location.pathname);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BeautyApp />
  </React.StrictMode>,
);

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
