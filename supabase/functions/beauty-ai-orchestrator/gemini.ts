import {
  AI_MAX_REPLY_LENGTH,
  AI_MAX_TOOL_ROUNDS,
  geminiConfig,
} from '../_shared/beautyAi.ts';
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
Si quieren pedir cita, reúne servicio, fecha, franja horaria y profesional opcional.
Ofrece únicamente huecos devueltos por get_availability y nunca afirmes que una cita
está creada o confirmada. Si el cliente quiere confirmar, indica que todavía necesita
confirmación del negocio y solicita atención humana.
Ante reclamaciones, urgencias, confusión, peticiones expresas de una persona o algo que
no puedas resolver con estas herramientas, usa request_human_handoff.
No redactes textos largos ni menciones herramientas, bases de datos o sistemas internos.
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
  {
    name: 'get_availability',
    description: 'Consulta hasta cinco huecos reales para un servicio y fecha del negocio actual.',
    parameters: {
      type: 'OBJECT',
      properties: {
        service_id: { type: 'STRING', description: 'ID exacto devuelto por list_services.' },
        date: { type: 'STRING', description: 'Fecha local YYYY-MM-DD solicitada por el cliente.' },
        staff_id: { type: 'STRING', description: 'ID opcional de profesional.' },
      },
      required: ['service_id', 'date'],
    },
  },
  {
    name: 'request_human_handoff',
    description: 'Deriva la conversación a una persona cuando no debe seguir respondiendo la IA.',
    parameters: {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          enum: ['requested', 'complaint', 'urgent', 'confused', 'unsupported'],
        },
      },
      required: ['reason'],
    },
  },
];

function historyContents(messages: RecentMessage[]): GeminiContent[] {
  return messages.filter((message) => message.text_content?.trim()).map((message) => ({
    role: message.direction === 'inbound' ? 'user' : 'model',
    parts: [{ text: message.text_content!.slice(0, 2000) }],
  }));
}

async function geminiFetch(path: string, init: RequestInit) {
  const { apiKey } = geminiConfig();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error('GEMINI_REQUEST_FAILED');
  return response.json();
}

export async function validateConfiguredGeminiModel() {
  const { model } = geminiConfig();
  const metadata = await geminiFetch(`models/${encodeURIComponent(model)}`, { method: 'GET' }) as {
    supportedGenerationMethods?: string[];
  };
  if (!metadata.supportedGenerationMethods?.includes('generateContent')) {
    throw new Error('GEMINI_MODEL_UNAVAILABLE');
  }
  return model;
}

export async function generateBeautyReply(
  messages: RecentMessage[],
  execute: GeminiToolExecutor,
) {
  const model = await validateConfiguredGeminiModel();
  const contents = historyContents(messages);
  let allowedAvailabilityTimes: Set<string> | null = null;
  if (!contents.length) throw new Error('GEMINI_RESPONSE_INVALID');

  for (let round = 0; round < AI_MAX_TOOL_ROUNDS; round += 1) {
    const response = await geminiFetch(`models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: beautyReceptionPrompt }] },
        contents,
        tools: [{ functionDeclarations }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 500,
        },
      }),
    }) as GeminiResponse;
    const modelContent = response.candidates?.[0]?.content;
    if (!modelContent?.parts?.length) throw new Error('GEMINI_RESPONSE_INVALID');

    const functionPart = modelContent.parts.find((part) => part.functionCall?.name);
    if (!functionPart?.functionCall?.name) {
      const text = modelContent.parts.map((part) => part.text ?? '').join('').trim();
      if (!text || !validateAvailabilityClaims(text, allowedAvailabilityTimes)) {
        throw new Error('GEMINI_RESPONSE_INVALID');
      }
      return { text: text.slice(0, AI_MAX_REPLY_LENGTH), handoffRequested: false };
    }

    const call = {
      name: functionPart.functionCall.name,
      args: functionPart.functionCall.args ?? {},
    } as ToolCall;
    const result = await execute(call);
    if (result.handoffRequested) return { text: null, handoffRequested: true };
    if (call.name === 'get_availability') {
      const slots = Array.isArray(result.value.slots) ? result.value.slots as Array<Record<string, unknown>> : [];
      allowedAvailabilityTimes = new Set(slots.map((slot) => String(slot.startsAt ?? '').slice(-5)));
    }

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
