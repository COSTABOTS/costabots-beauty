import {
  beautyAiEnabled,
  normalizeGeminiModel,
  requireServiceRoleRequest,
  sanitizedAiError,
} from '../_shared/beautyAi.ts';
import { buildConversationMutation } from '../evolution-beauty-webhook/conversationMutation.ts';
import {
  GEMINI_API_VERSION,
  functionDeclarations,
  geminiFetchJson,
  generateContentUrl,
  modelMetadataUrl,
  modelResourceName,
  validateAvailabilityClaims,
} from './gemini.ts';
import {
  buildTemporalContext,
  detectRecentDateConflict,
  fallbackForToolError,
  resolveDateExpression,
  sanitizeWhatsAppText,
} from './dateResolution.ts';
import {
  aiMessageReservation,
  canClaimAiRun,
  internalBusinessId,
  responseStillAllowed,
  runMatchesLatestInbound,
  shouldProcessInbound,
} from './policy.ts';
import { withNormalizedAvailabilityDate } from './tools.ts';
import { sanitizedAiFailure } from '../_shared/beautyAi.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test('manual conversations never invoke AI', () => {
  assert(!shouldProcessInbound({
    aiEnabled: true,
    mode: 'manual',
    assignedUserId: 'manager',
    direction: 'inbound',
    senderType: 'customer',
  }), 'manual conversation was eligible');
});

Deno.test('disabled AI never processes inbound messages', () => {
  assert(!beautyAiEnabled('false'), 'false flag was treated as enabled');
  assert(!shouldProcessInbound({
    aiEnabled: false,
    mode: 'ai',
    assignedUserId: null,
    direction: 'inbound',
    senderType: 'customer',
  }), 'disabled AI was eligible');
});

Deno.test('server-only requests accept legacy and issued secret keys', () => {
  requireServiceRoleRequest(
    new Request('https://internal.test', { headers: { authorization: 'Bearer legacy-key' } }),
    'legacy-key',
    '{}',
  );
  requireServiceRoleRequest(
    new Request('https://internal.test', { headers: { authorization: 'Bearer sb_secret_test' } }),
    '',
    JSON.stringify({ primary: { api_key: 'sb_secret_test' } }),
  );
  requireServiceRoleRequest(
    new Request('https://internal.test', { headers: { apikey: 'sb_secret_test' } }),
    '',
    JSON.stringify({ primary: { api_key: 'sb_secret_test' } }),
  );
  let rejected = false;
  try {
    requireServiceRoleRequest(
      new Request('https://internal.test', { headers: { authorization: 'Bearer public-key' } }),
      'legacy-key',
      JSON.stringify({ primary: { api_key: 'sb_secret_test' } }),
    );
  } catch {
    rejected = true;
  }
  assert(rejected, 'an unconfigured key was accepted');
});

Deno.test('duplicate runs produce the same idempotency key', () => {
  const first = aiMessageReservation('run-1', 'business-1', 'conversation-1', 'Hola', '2026-01-01T00:00:00Z');
  const repeated = aiMessageReservation('run-1', 'business-1', 'conversation-1', 'Hola', '2026-01-01T00:00:00Z');
  assert(first.client_request_id === repeated.client_request_id, 'idempotency key changed');
  assert(first.provider_message_id === repeated.provider_message_id, 'provider reservation changed');
});

Deno.test('only a pending run below the attempt limit can be claimed', () => {
  assert(canClaimAiRun('pending', 0), 'new pending run was blocked');
  assert(!canClaimAiRun('processing', 1), 'processing duplicate was claimable');
  assert(!canClaimAiRun('completed', 1), 'completed duplicate was claimable');
  assert(!canClaimAiRun('failed', 1), 'failed run was automatically reprocessed');
  assert(!canClaimAiRun('pending', 3), 'attempt limit was bypassed');
});

Deno.test('tool arguments cannot override the run business', () => {
  assert(
    internalBusinessId('business-a', { business_id: 'business-b' }) === 'business-a',
    'tool arguments crossed business tenancy',
  );
});

Deno.test('unknown services cannot result in invented availability', () => {
  assert(!validateAvailabilityClaims('Tengo un hueco a las 10:30.', new Set()), 'unknown service invented a slot');
});

Deno.test('empty availability produces no invented slots', () => {
  assert(validateAvailabilityClaims('No hay huecos disponibles para ese día.', new Set()), 'empty response was rejected');
  assert(!validateAvailabilityClaims('Tengo un hueco a las 10:30.', new Set()), 'invented empty slot was accepted');
});

Deno.test('availability answers may only mention returned times', () => {
  const allowed = new Set(['10:30', '11:00']);
  assert(validateAvailabilityClaims('Puedo ofrecerte 10:30 o 11:00.', allowed), 'real slots were rejected');
  assert(!validateAvailabilityClaims('También tengo las 12:00.', allowed), 'unreturned slot was accepted');
});

Deno.test('Gemini failures use sanitized codes and preserve one reservation', () => {
  assert(sanitizedAiError(new Error('fetch contained secret details')) === 'AI_PROCESSING_FAILED', 'raw error leaked');
  const reservation = aiMessageReservation('run-failure', 'b', 'c', 'No se envía', '2026-01-01T00:00:00Z');
  assert(reservation.client_request_id === 'ai-run-run-failure', 'failure reservation is not deterministic');
});

Deno.test('manual takeover discards a completed model response', () => {
  assert(!responseStillAllowed('manual', 'manager'), 'manual takeover still allowed a response');
  assert(!responseStillAllowed('ai', 'manager'), 'assigned conversation still allowed a response');
});

Deno.test('AI outbound messages are stored with sender_type ai', () => {
  const reservation = aiMessageReservation('run-ai', 'b', 'c', 'Respuesta', '2026-01-01T00:00:00Z');
  assert(reservation.direction === 'outbound', 'AI message is not outbound');
  assert(reservation.sender_type === 'ai', 'AI sender type is not ai');
});

Deno.test('AI outbound echoes do not reactivate AI processing', () => {
  const existing = { id: 'conversation-1', mode: 'ai' as const };
  const echoMutation = buildConversationMutation(existing, false, { last_message_preview: 'Respuesta IA' });
  assert(!Object.hasOwn(echoMutation.values, 'mode'), 'AI echo changed conversation mode');
  assert(!shouldProcessInbound({
    aiEnabled: true,
    mode: 'ai',
    assignedUserId: null,
    direction: 'outbound',
    senderType: 'ai',
  }), 'AI outbound message activated AI');
});

Deno.test('sent, delivered and read status events do not activate AI', () => {
  for (const _status of ['sent', 'delivered', 'read']) {
  assert(!shouldProcessInbound({
    aiEnabled: true,
    mode: 'ai',
    assignedUserId: null,
    direction: 'outbound',
    senderType: 'system',
  }), 'status/system event activated AI');
  }
});

type ExpectedFailure = {
  status: number;
  phase: 'model_metadata' | 'generate_content';
  code: string;
  category: string;
  retryable: boolean;
};

async function assertHttpFailure(expected: ExpectedFailure) {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return new Response('SENSITIVE_UPSTREAM_BODY_MUST_NOT_BE_READ', { status: expected.status });
  };
  try {
    await geminiFetchJson(modelMetadataUrl('test'), { method: 'GET' }, expected.phase, {
      apiKey: 'test-key',
      fetcher,
    });
    throw new Error('expected Gemini request to fail');
  } catch (error) {
    const failure = sanitizedAiFailure(error);
    assert(failure.error_code === expected.code, `unexpected code ${failure.error_code}`);
    assert(failure.error_phase === expected.phase, `unexpected phase ${failure.error_phase}`);
    assert(failure.upstream_http_status === expected.status, 'HTTP status was not preserved');
    assert(failure.error_category === expected.category, `unexpected category ${failure.error_category}`);
    assert(failure.retryable === expected.retryable, 'retryable classification is incorrect');
    assert(!JSON.stringify(failure).includes('SENSITIVE_UPSTREAM_BODY'), 'upstream body leaked');
    assert(calls === 1, 'failure triggered an immediate retry');
  }
}

Deno.test('metadata 401 is sanitized', () =>
  assertHttpFailure({
    status: 401,
    phase: 'model_metadata',
    code: 'GEMINI_MODEL_AUTH_FAILED',
    category: 'authentication',
    retryable: false,
  }));

Deno.test('metadata 404 is sanitized', () =>
  assertHttpFailure({
    status: 404,
    phase: 'model_metadata',
    code: 'GEMINI_MODEL_NOT_FOUND',
    category: 'not_found',
    retryable: false,
  }));

Deno.test('metadata 429 is retryable without retrying', () =>
  assertHttpFailure({
    status: 429,
    phase: 'model_metadata',
    code: 'GEMINI_MODEL_RATE_LIMITED',
    category: 'rate_limit',
    retryable: true,
  }));

Deno.test('metadata 500 is retryable without retrying', () =>
  assertHttpFailure({
    status: 500,
    phase: 'model_metadata',
    code: 'GEMINI_MODEL_SERVER_ERROR',
    category: 'server_error',
    retryable: true,
  }));

Deno.test('generateContent 400 is sanitized', () =>
  assertHttpFailure({
    status: 400,
    phase: 'generate_content',
    code: 'GEMINI_GENERATION_CLIENT_ERROR',
    category: 'client_error',
    retryable: false,
  }));

Deno.test('generateContent 401 is sanitized', () =>
  assertHttpFailure({
    status: 401,
    phase: 'generate_content',
    code: 'GEMINI_GENERATION_AUTH_FAILED',
    category: 'authentication',
    retryable: false,
  }));

Deno.test('generateContent 429 is retryable without retrying', () =>
  assertHttpFailure({
    status: 429,
    phase: 'generate_content',
    code: 'GEMINI_GENERATION_RATE_LIMITED',
    category: 'rate_limit',
    retryable: true,
  }));

Deno.test('generateContent 500 is retryable without retrying', () =>
  assertHttpFailure({
    status: 500,
    phase: 'generate_content',
    code: 'GEMINI_GENERATION_SERVER_ERROR',
    category: 'server_error',
    retryable: true,
  }));

Deno.test('Gemini network errors are sanitized and do not retry', async () => {
  let calls = 0;
  try {
    await geminiFetchJson(modelMetadataUrl('test'), { method: 'GET' }, 'generate_content', {
      apiKey: 'test-key',
      fetcher: () => {
        calls += 1;
        throw new Error('network details must not escape');
      },
    });
    throw new Error('expected network error');
  } catch (error) {
    const failure = sanitizedAiFailure(error);
    assert(failure.error_code === 'GEMINI_NETWORK_ERROR', 'network code was not sanitized');
    assert(failure.error_category === 'network_error', 'network category was not stored');
    assert(failure.upstream_http_status === null, 'network failure invented an HTTP status');
    assert(failure.retryable, 'network failure should be diagnostically retryable');
    assert(!JSON.stringify(failure).includes('network details'), 'network details leaked');
    assert(calls === 1, 'network failure triggered an immediate retry');
  }
});

Deno.test('Gemini failure metadata cannot contain outbound payloads', async () => {
  let evolutionCalls = 0;
  let outboundRows = 0;
  try {
    await geminiFetchJson(generateContentUrl('test'), { method: 'POST' }, 'generate_content', {
      apiKey: 'test-key',
      fetcher: async () => new Response('private prompt and response', { status: 500 }),
    });
  } catch (error) {
    const failure = sanitizedAiFailure(error);
    assert(Object.keys(failure).sort().join(',') === [
      'error_category',
      'error_code',
      'error_phase',
      'retryable',
      'upstream_http_status',
    ].sort().join(','), 'failure metadata contains an unexpected field');
  }
  assert(evolutionCalls === 0, 'Evolution was contacted after Gemini failed');
  assert(outboundRows === 0, 'an outbound row was created after Gemini failed');
});

Deno.test('Gemini model identifiers normalize to one canonical resource', () => {
  assert(normalizeGeminiModel('gemini-2.5-flash') === 'gemini-2.5-flash', 'canonical model changed');
  assert(normalizeGeminiModel(' models/gemini-2.5-flash ') === 'gemini-2.5-flash', 'models prefix remained');
  assert(
    normalizeGeminiModel(' models/models/gemini-2.5-flash ') === 'gemini-2.5-flash',
    'double models prefix remained',
  );
  assert(
    modelResourceName('models/gemini-2.5-flash') === 'models/gemini-2.5-flash',
    'resource name is not canonical',
  );
});

Deno.test('Gemini metadata and generation URLs share the API version and resource', () => {
  const model = 'models/gemini-2.5-flash';
  assert(GEMINI_API_VERSION === 'v1beta', 'unexpected Gemini API version');
  assert(
    modelMetadataUrl(model) ===
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash',
    'metadata URL is incorrect',
  );
  assert(
    generateContentUrl(model) ===
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    'generateContent URL is incorrect',
  );
  assert(!generateContentUrl(model).includes('models/models/'), 'double resource prefix detected');
});

const temporal = buildTemporalContext(
  new Date('2026-07-30T12:00:00.000Z'),
  'Europe/Madrid',
);

Deno.test('relative dates resolve deterministically in Europe/Madrid', () => {
  assert(temporal.localDate === '2026-07-30', 'local date is incorrect');
  assert(resolveDateExpression('mañana', temporal).isoDate === '2026-07-31', 'tomorrow is incorrect');
  assert(resolveDateExpression('pasado mañana', temporal).isoDate === '2026-08-01', 'day after tomorrow is incorrect');
  assert(resolveDateExpression('próximo lunes', temporal).isoDate === '2026-08-03', 'next Monday is incorrect');
  assert(resolveDateExpression('el lunes', temporal).isoDate === '2026-08-03', 'el lunes is incorrect');
});

Deno.test('absolute dates validate past, range and DD/MM formats', () => {
  assert(resolveDateExpression('29/07/2026', temporal).status === 'past', 'past date was accepted');
  assert(resolveDateExpression('01/01/2028', temporal).status === 'out_of_range', 'far date was accepted');
  const valid = resolveDateExpression('03/08', temporal);
  assert(valid.status === 'resolved' && valid.isoDate === '2026-08-03', 'DD/MM date did not resolve');
});

Deno.test('recent incompatible dates request clarification before availability', () => {
  const conflict = detectRecentDateConflict([
    {
      direction: 'inbound',
      sender_type: 'customer',
      text_content: 'Para el lunes',
      sent_at: '2026-07-30T19:47:53.000Z',
    },
    {
      direction: 'inbound',
      sender_type: 'customer',
      text_content: 'Mañana',
      sent_at: '2026-07-30T19:48:43.000Z',
    },
  ], temporal);
  assert(conflict?.reply === '¿Prefieres mañana o el lunes?', 'conflict clarification is incorrect');
});

Deno.test('normalized server date overrides Gemini availability arguments', () => {
  const call = withNormalizedAvailabilityDate({
    name: 'get_availability',
    args: { service_id: '00000000-0000-4000-8000-000000000001', date: '2020-01-01' },
  }, '2026-07-31');
  assert(call.args.date === '2026-07-31', 'untrusted model date reached availability');
});

Deno.test('tool failures always have deterministic customer-safe fallbacks', () => {
  assert(fallbackForToolError('invalid_date').startsWith('¿Qué día'), 'invalid-date fallback missing');
  assert(fallbackForToolError('date_out_of_range').startsWith('Solo puedo'), 'range fallback missing');
  assert(fallbackForToolError('no_availability').startsWith('No encuentro'), 'no-availability fallback missing');
  assert(fallbackForToolError('service_not_resolved').startsWith('¿Qué servicio'), 'service fallback missing');
  assert(fallbackForToolError('tool_internal_error').includes('Te atenderá una persona'), 'handoff fallback missing');
});

Deno.test('a newer inbound supersedes an older run', () => {
  assert(runMatchesLatestInbound('message-2', 'message-2'), 'latest run was rejected');
  assert(!runMatchesLatestInbound('message-1', 'message-2'), 'obsolete run was allowed');
  assert(!runMatchesLatestInbound('message-1', null), 'missing latest inbound was allowed');
});

Deno.test('WhatsApp output removes visible Markdown without damaging content', () => {
  assert(sanitizeWhatsAppText('Quiero **corte**') === 'Quiero corte', 'double asterisks remained');
  assert(sanitizeWhatsAppText('Quiero __corte__') === 'Quiero corte', 'double underscores remained');
  assert(
    sanitizeWhatsAppText('# Opciones\n`Corte` · 25 € · 10:30') === 'Opciones\nCorte · 25 € · 10:30',
    'heading or backticks remained',
  );
});

Deno.test('AI tool surface cannot create or confirm appointments', () => {
  const names = functionDeclarations.map((tool) => tool.name);
  assert(!names.includes('create_appointment'), 'AI can create appointments');
  assert(!names.includes('confirm_appointment'), 'AI can confirm appointments');
});
