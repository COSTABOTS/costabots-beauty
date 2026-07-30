import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const AI_HISTORY_LIMIT = 12;
export const AI_MAX_TOOL_ROUNDS = 4;
export const AI_MAX_REPLY_LENGTH = 2000;

export type BeautyAiRunStatus = 'pending' | 'processing' | 'completed' | 'skipped' | 'failed';

export function beautyAiEnabled(envValue = Deno.env.get('BEAUTY_AI_ENABLED')) {
  return envValue?.trim().toLowerCase() === 'true';
}

export function geminiConfig() {
  const apiKey = Deno.env.get('GEMINI_API_KEY')?.trim() ?? '';
  const rawModel = Deno.env.get('GEMINI_MODEL')?.trim() ?? '';
  const model = rawModel.replace(/^models\//, '');
  if (!apiKey || !model || !/^[A-Za-z0-9._-]{2,100}$/.test(model)) {
    throw new Error('GEMINI_CONFIGURATION_INVALID');
  }
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

export function requireServiceRoleRequest(request: Request) {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supplied = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!constantTimeEqual(expected, supplied)) throw new Error('SERVICE_ROLE_REQUIRED');
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
    'GEMINI_RESPONSE_INVALID',
    'AI_TOOL_INVALID',
    'AI_TOOL_FAILED',
    'AI_MESSAGE_SEND_FAILED',
  ]);
  return allowed.has(message) ? message : 'AI_PROCESSING_FAILED';
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
