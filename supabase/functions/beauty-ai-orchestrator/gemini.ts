import {
  AI_MAX_REPLY_LENGTH,
  AI_MAX_TOOL_ROUNDS,
  GeminiRequestError,
  geminiConfig,
  normalizeGeminiModel,
} from '../_shared/beautyAi.ts';
import type { BeautyAiErrorCategory, BeautyAiErrorPhase } from '../_shared/beautyAi.ts';
import { sanitizeWhatsAppText, temporalInstruction } from './dateResolution.ts';
import type { TemporalContext } from './dateResolution.ts';
import type { RecentMessage, ToolCall, ToolExecutionResult } from './types.ts';

type GeminiPart = {
  text?: string;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
};

type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiPart[];
};

type GeminiResponse = {
  candidates?: Array<{ content?: GeminiContent }>;
};

export type GeminiToolExecutor = (call: ToolCall) => Promise<ToolExecutionResult>;

export function validateAvailabilityClaims(text: string, allowedTimes: Set<string> | null) {
  if (allowedTimes === null) return true;
  const mentioned = text.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g) ?? [];
  return mentioned.every((time) => allowedTimes.has(time.padStart(5, '0')));
}

export const beautyReceptionPrompt = `
Eres la asistente de recepción por WhatsApp de un pequeño negocio de belleza.
Responde de manera breve, natural, cercana y en el idioma del cliente.
Usa exclusivamente datos devueltos por las herramientas. Nunca inventes servicios,
precios, duración, profesionales, horarios, dirección ni disponibilidad.
Pregunta una sola cosa cada vez cuando falten datos.
Puedes saludar, explicar servicios, precios, duración y datos públicos del negocio.
Las reservas se gestionan fuera de este generador mediante una máquina de estados.
No recopiles datos de reserva, no ofrezcas disponibilidad, no confirmes citas y no
solicites handoffs. Limítate a información pública del negocio y sus servicios.
No redactes textos largos ni menciones herramientas, bases de datos o sistemas internos.
No uses Markdown, encabezados, backticks ni asteriscos para negrita.
Responde como un mensaje natural de WhatsApp en texto plano.
`.trim();

export const functionDeclarations = [
  {
    name: 'get_business_info',
    description: 'Obtiene datos públicos y horarios reales del negocio actual.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'list_services',
    description: 'Lista los servicios activos y reservables del negocio actual con precio y duración.',
    parameters: { type: 'OBJECT', properties: {} },
  },
];

function historyContents(messages: RecentMessage[]): GeminiContent[] {
  return messages.filter((message) => message.text_content?.trim()).map((message) => ({
    role: message.direction === 'inbound' ? 'user' : 'model',
    parts: [{ text: message.text_content!.slice(0, 2000) }],
  }));
}

type GeminiFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export const GEMINI_API_VERSION = 'v1beta';
const GEMINI_API_ORIGIN = 'https://generativelanguage.googleapis.com';

export function modelResourceName(model: string) {
  return `models/${normalizeGeminiModel(model)}`;
}

export function modelMetadataUrl(model: string) {
  return `${GEMINI_API_ORIGIN}/${GEMINI_API_VERSION}/${modelResourceName(model)}`;
}

export function generateContentUrl(model: string) {
  return `${GEMINI_API_ORIGIN}/${GEMINI_API_VERSION}/${modelResourceName(model)}:generateContent`;
}

function classifyHttpStatus(status: number): {
  category: BeautyAiErrorCategory;
  suffix: 'AUTH_FAILED' | 'NOT_FOUND' | 'RATE_LIMITED' | 'CLIENT_ERROR' | 'SERVER_ERROR';
  retryable: boolean;
} {
  if (status === 401 || status === 403) {
    return { category: 'authentication', suffix: 'AUTH_FAILED', retryable: false };
  }
  if (status === 404) return { category: 'not_found', suffix: 'NOT_FOUND', retryable: false };
  if (status === 429) return { category: 'rate_limit', suffix: 'RATE_LIMITED', retryable: true };
  if (status >= 500) return { category: 'server_error', suffix: 'SERVER_ERROR', retryable: true };
  return { category: 'client_error', suffix: 'CLIENT_ERROR', retryable: false };
}

export async function geminiFetchJson(
  url: string,
  init: RequestInit,
  phase: BeautyAiErrorPhase,
  options: { apiKey?: string; fetcher?: GeminiFetch } = {},
) {
  const apiKey = options.apiKey ?? geminiConfig().apiKey;
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(url, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new GeminiRequestError({
      error_code: 'GEMINI_NETWORK_ERROR',
      error_phase: phase,
      upstream_http_status: null,
      error_category: 'network_error',
      retryable: true,
    });
  }
  if (!response.ok) {
    const classified = classifyHttpStatus(response.status);
    const prefix = phase === 'model_metadata' ? 'GEMINI_MODEL' : 'GEMINI_GENERATION';
    throw new GeminiRequestError({
      error_code: `${prefix}_${classified.suffix}`,
      error_phase: phase,
      upstream_http_status: response.status,
      error_category: classified.category,
      retryable: classified.retryable,
    });
  }
  return response.json();
}

export async function validateConfiguredGeminiModel() {
  const { model } = geminiConfig();
  const metadata = await geminiFetchJson(
    modelMetadataUrl(model),
    { method: 'GET' },
    'model_metadata',
  ) as {
    supportedGenerationMethods?: string[];
  };
  if (!metadata.supportedGenerationMethods?.includes('generateContent')) {
    throw new Error('GEMINI_MODEL_UNAVAILABLE');
  }
  return model;
}

export async function validateMinimalGenerateContent() {
  const model = await validateConfiguredGeminiModel();
  await geminiFetchJson(
    generateContentUrl(model),
    {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Responde únicamente OK.' }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
    },
    'generate_content',
  );
  return model;
}

export async function generateBeautyReply(
  messages: RecentMessage[],
  execute: GeminiToolExecutor,
  temporalContext: TemporalContext,
) {
  const model = await validateConfiguredGeminiModel();
  const contents = historyContents(messages);
  if (!contents.length) throw new Error('GEMINI_RESPONSE_INVALID');

  for (let round = 0; round < AI_MAX_TOOL_ROUNDS; round += 1) {
    const phase: BeautyAiErrorPhase = round === 0
      ? 'generate_content'
      : 'tool_followup_generate_content';
    const response = await geminiFetchJson(
      generateContentUrl(model),
      {
        method: 'POST',
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: `${beautyReceptionPrompt}\n\n${temporalInstruction(temporalContext)}` }],
          },
          contents,
          tools: [{ functionDeclarations }],
          generationConfig: {
            maxOutputTokens: 500,
          },
        }),
      },
      phase,
    ) as GeminiResponse;
    const modelContent = response.candidates?.[0]?.content;
    if (!modelContent?.parts?.length) throw new Error('GEMINI_RESPONSE_INVALID');

    const functionPart = modelContent.parts.find((part) => part.functionCall?.name);
    if (!functionPart?.functionCall?.name) {
      const text = sanitizeWhatsAppText(modelContent.parts.map((part) => part.text ?? '').join(''));
      if (!text) {
        throw new Error('GEMINI_RESPONSE_INVALID');
      }
      return { text: text.slice(0, AI_MAX_REPLY_LENGTH), handoffRequested: false };
    }

    const call = {
      name: functionPart.functionCall.name,
      args: functionPart.functionCall.args ?? {},
    } as ToolCall;
    const result = await execute(call);
    contents.push({ role: 'model', parts: modelContent.parts });
    contents.push({
      role: 'user',
      parts: [{
        functionResponse: {
          name: call.name,
          response: { result: result.value },
        },
      }],
    });
  }
  throw new Error('GEMINI_RESPONSE_INVALID');
}
