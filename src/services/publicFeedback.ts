import { requireBeautyPublicApi } from '../config/environment';

export type FeedbackSubmitState = 'idle' | 'sending' | 'success' | 'already_submitted' | 'error';

export interface SubmitFeedbackPayload {
  id_reserva: string;
  puntuacion: number;
  puntuacion_texto: string;
  comentario: string;
  lang?: 'es' | 'en';
  timestamp: string;
}

export interface PublicFeedbackClientContext {
  clientId: string;
  publicToken: string;
  isLegacySafariFallback: boolean;
}

export interface PublicFeedbackDetailsResponse {
  ok?: boolean;
  encontrada?: boolean;
  already_submitted?: boolean;
  branding?: Record<string, unknown>;
  review_links?: Record<string, unknown>;
}

async function readJsonResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get('Content-Type') ?? '';
  const rawText = await response.text();

  if (!contentType.toLowerCase().includes('application/json')) {
    if (rawText.trim()) {
      console.warn('[COSTABOTS Beauty] Respuesta pública de feedback no JSON', {
        status: response.status,
        contentType,
      });
    }
    return null;
  }

  if (!rawText.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawText) as T;
  } catch {
    console.warn('[COSTABOTS Beauty] Respuesta pública de feedback JSON inválida', {
      status: response.status,
      contentType,
    });
    return null;
  }
}

function toStringValue(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function maskPublicToken(token: string) {
  if (!token) return '';
  if (token.length <= 8) return '***';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function getPublicFeedbackClientContextFromUrl(): PublicFeedbackClientContext {
  const params = new URLSearchParams(window.location.search);
  const clientId = toStringValue(params.get('client_id')) || toStringValue(params.get('clientId'));
  const publicToken = toStringValue(params.get('public_token')) || toStringValue(params.get('publicToken'));

  if (clientId && publicToken) {
    return {
      clientId,
      publicToken,
      isLegacySafariFallback: false,
    };
  }

  throw new Error('[COSTABOTS Beauty] Falta el contexto público de feedback. El fallback heredado de Safari está deshabilitado.');
}

export async function loadPublicFeedbackDetails(idReserva: string, clientContext: PublicFeedbackClientContext) {
  console.log('[COSTABOTS Beauty] Feedback details context', {
    clientId: clientContext.clientId,
    publicToken: maskPublicToken(clientContext.publicToken),
    legacy: clientContext.isLegacySafariFallback,
  });

  const response = await fetch(`${requireBeautyPublicApi()}/feedback/details`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientContext.clientId,
      public_token: clientContext.publicToken,
      id_reserva: idReserva,
    }),
  });

  if (!response.ok) {
    throw new Error(`Feedback details request failed with status ${response.status}`);
  }

  return readJsonResponse<PublicFeedbackDetailsResponse>(response);
}

export async function submitFeedback(payload: SubmitFeedbackPayload, clientContext: PublicFeedbackClientContext) {
  console.log('[COSTABOTS Beauty] Feedback submit context', {
    clientId: clientContext.clientId,
    publicToken: maskPublicToken(clientContext.publicToken),
    legacy: clientContext.isLegacySafariFallback,
  });

  const response = await fetch(`${requireBeautyPublicApi()}/feedback/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientContext.clientId,
      public_token: clientContext.publicToken,
      ...payload,
    }),
  });

  const data = await readJsonResponse<Record<string, unknown>>(response);
  if (data?.already_submitted === true) {
    return { success: false, skipped: true, alreadySubmitted: true };
  }

  if (!response.ok || !data) {
    throw new Error(`Feedback request failed with status ${response.status}`);
  }

  if (data.ok !== true) {
    throw new Error(String(data.error ?? data.code ?? 'Feedback request failed'));
  }

  return {
    success: true,
    skipped: false,
    alreadySubmitted: false,
    positive: data.positive === true,
  };
}
