import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const AI_HISTORY_LIMIT = 12;
export const AI_MAX_TOOL_ROUNDS = 4;
export const AI_MAX_REPLY_LENGTH = 2000;

export type BeautyAiRunStatus = 'pending' | 'processing' | 'completed' | 'skipped' | 'failed';
export type BeautyAiErrorPhase =
  | 'model_metadata'
  | 'generate_content'
  | 'tool_followup_generate_content';
export type BeautyAiErrorCategory =
  | 'authentication'
  | 'not_found'
  | 'rate_limit'
  | 'client_error'
  | 'server_error'
  | 'network_error';

export type SanitizedAiFailure = {
  error_code: string;
  error_phase: BeautyAiErrorPhase | null;
  upstream_http_status: number | null;
  error_category: BeautyAiErrorCategory | null;
  retryable: boolean;
};

export class GeminiRequestError extends Error {
  readonly phase: BeautyAiErrorPhase;
  readonly status: number | null;
  readonly category: BeautyAiErrorCategory;
  readonly retryable: boolean;

  constructor(values: SanitizedAiFailure & { error_phase: BeautyAiErrorPhase; error_category: BeautyAiErrorCategory }) {
    super(values.error_code);
    this.name = 'GeminiRequestError';
    this.phase = values.error_phase;
    this.status = values.upstream_http_status;
    this.category = values.error_category;
    this.retryable = values.retryable;
  }
}

export function beautyAiEnabled(envValue = Deno.env.get('BEAUTY_AI_ENABLED')) {
  return envValue?.trim().toLowerCase() === 'true';
}

export function normalizeGeminiModel(value: string) {
  let model = value.trim();
  while (model.startsWith('models/')) model = model.slice('models/'.length).trim();
  if (!model || !/^[A-Za-z0-9._-]{2,100}$/.test(model)) {
    throw new Error('GEMINI_CONFIGURATION_INVALID');
  }
  return model;
}

export function geminiConfig() {
  const apiKey = Deno.env.get('GEMINI_API_KEY')?.trim() ?? '';
  const rawModel = Deno.env.get('GEMINI_MODEL')?.trim() ?? '';
  if (!apiKey) {
    throw new Error('GEMINI_CONFIGURATION_INVALID');
  }
  const model = normalizeGeminiModel(rawModel);
  return { apiKey, model };
}

function constantTimeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function configuredServerKeys(
  legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  issuedKeysJson = Deno.env.get('SUPABASE_SECRET_KEYS') ?? '',
) {
  const keys = legacyKey ? [legacyKey] : [];
  const collectIssuedKeys = (value: unknown) => {
    if (typeof value === 'string') {
      if (value.startsWith('sb_secret_')) keys.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(collectIssuedKeys);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(collectIssuedKeys);
    }
  };
  try {
    collectIssuedKeys(JSON.parse(issuedKeysJson));
  } catch {
    // Missing or malformed optional issued-key metadata must not weaken auth.
  }
  return keys;
}

export function requireServiceRoleRequest(
  request: Request,
  legacyKey?: string,
  issuedKeysJson?: string,
) {
  const authorization = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const apiKey = (request.headers.get('apikey') ?? '').trim();
  const accepted = configuredServerKeys(legacyKey, issuedKeysJson)
    .some((expected) =>
      constantTimeEqual(expected, authorization) || constantTimeEqual(expected, apiKey)
    );
  if (!accepted) throw new Error('SERVICE_ROLE_REQUIRED');
}

export function sanitizedAiError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const allowed = new Set([
    'AI_DISABLED',
    'AI_RUN_NOT_FOUND',
    'AI_RUN_NOT_CLAIMED',
    'CONVERSATION_NOT_ELIGIBLE',
    'GEMINI_CONFIGURATION_INVALID',
    'GEMINI_MODEL_UNAVAILABLE',
    'GEMINI_REQUEST_FAILED',
    'GEMINI_MODEL_AUTH_FAILED',
    'GEMINI_MODEL_NOT_FOUND',
    'GEMINI_MODEL_RATE_LIMITED',
    'GEMINI_MODEL_CLIENT_ERROR',
    'GEMINI_MODEL_SERVER_ERROR',
    'GEMINI_GENERATION_AUTH_FAILED',
    'GEMINI_GENERATION_NOT_FOUND',
    'GEMINI_GENERATION_RATE_LIMITED',
    'GEMINI_GENERATION_CLIENT_ERROR',
    'GEMINI_GENERATION_SERVER_ERROR',
    'GEMINI_NETWORK_ERROR',
    'GEMINI_RESPONSE_INVALID',
    'AI_TOOL_INVALID',
    'AI_TOOL_FAILED',
    'AI_MESSAGE_SEND_FAILED',
    'SUPERSEDED_BY_NEWER_INBOUND',
  ]);
  return allowed.has(message) ? message : 'AI_PROCESSING_FAILED';
}

export function sanitizedAiFailure(error: unknown): SanitizedAiFailure {
  if (error instanceof GeminiRequestError) {
    return {
      error_code: sanitizedAiError(error),
      error_phase: error.phase,
      upstream_http_status: error.status,
      error_category: error.category,
      retryable: error.retryable,
    };
  }
  return {
    error_code: sanitizedAiError(error),
    error_phase: null,
    upstream_http_status: null,
    error_category: null,
    retryable: false,
  };
}

export async function markAiRun(
  client: SupabaseClient,
  runId: string,
  status: BeautyAiRunStatus,
  values: Record<string, unknown> = {},
) {
  await client.from('beauty_ai_runs').update({
    status,
    ...values,
    completed_at: ['completed', 'skipped', 'failed'].includes(status) ? new Date().toISOString() : null,
  }).eq('id', runId);
}

export function beautyAiFunctionUrl() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.replace(/\/+$/, '');
  if (!supabaseUrl) throw new Error('SERVER_CONFIGURATION_MISSING');
  return `${supabaseUrl}/functions/v1/beauty-ai-orchestrator`;
}

export async function invokeBeautyAiRun(runId: string) {
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!serviceRole) throw new Error('SERVER_CONFIGURATION_MISSING');
  const response = await fetch(beautyAiFunctionUrl(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceRole}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ runId }),
  });
  if (!response.ok) throw new Error('AI_ORCHESTRATOR_INVOCATION_FAILED');
}
