import type { WalkInPayload } from '../types';
import { requireLegacyWebhooks } from '../config/environment';

const WEBHOOKS = {
  addWalkIn: import.meta.env.VITE_LEGACY_ADD_WALKIN_WEBHOOK as string | undefined,
  updateReservation: import.meta.env.VITE_LEGACY_UPDATE_RESERVATION_WEBHOOK as string | undefined,
};

async function postToMake(url: string | undefined, payload: unknown) {
  requireLegacyWebhooks();

  if (!url) {
    console.info('[COSTABOTS Beauty] Webhook heredado deshabilitado:', payload);
    return { ok: true, mocked: true };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook failed with status ${response.status}`);
  }

  return response.json().catch(() => ({ ok: true }));
}

export function sendWalkIn(payload: WalkInPayload) {
  return postToMake(WEBHOOKS.addWalkIn, {
    action: 'ADD_WALKIN',
    ...payload,
  });
}

export function updateReservationField(
  id: string,
  field: 'table' | 'arrived',
  value: string | boolean,
) {
  return postToMake(WEBHOOKS.updateReservation, {
    action: 'UPDATE_RESERVATION',
    id,
    field,
    value,
    updatedAt: new Date().toISOString(),
  });
}
