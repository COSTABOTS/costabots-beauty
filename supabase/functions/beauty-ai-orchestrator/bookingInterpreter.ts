import { geminiConfig } from '../_shared/beautyAi.ts';
import { geminiFetchJson, generateContentUrl, validateConfiguredGeminiModel } from './gemini.ts';
import { BOOKING_INTENTS } from './bookingTypes.ts';
import type { BookingInterpretation, BookingStatus } from './bookingTypes.ts';
import type { TemporalContext } from './dateResolution.ts';

const OPTION_REFERENCES = ['first', 'second', 'last', 'that'] as const;
const INTERPRETATION_KEYS = [
  'intent',
  'service_reference',
  'date_expression',
  'time_expression',
  'option_reference',
  'confirmation',
  'wants_human',
  'confidence',
] as const;

function nullableShortString(value: unknown) {
  return value === null || (typeof value === 'string' && value.length <= 160);
}

export function parseBookingInterpretation(value: unknown): BookingInterpretation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INTERPRETATION_INVALID');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join('|') !== [...INTERPRETATION_KEYS].sort().join('|')) {
    throw new Error('INTERPRETATION_INVALID');
  }
  if (!BOOKING_INTENTS.includes(record.intent as BookingInterpretation['intent'])) {
    throw new Error('INTERPRETATION_INVALID');
  }
  if (
    !nullableShortString(record.service_reference) ||
    !nullableShortString(record.date_expression) ||
    !nullableShortString(record.time_expression) ||
    !(record.option_reference === null ||
      OPTION_REFERENCES.includes(record.option_reference as typeof OPTION_REFERENCES[number])) ||
    !(record.confirmation === null || typeof record.confirmation === 'boolean') ||
    typeof record.wants_human !== 'boolean' ||
    typeof record.confidence !== 'number' ||
    !Number.isFinite(record.confidence) ||
    record.confidence < 0 ||
    record.confidence > 1
  ) {
    throw new Error('INTERPRETATION_INVALID');
  }
  return record as BookingInterpretation;
}

export async function interpretBookingMessage(input: {
  text: string;
  status: BookingStatus | null;
  temporal: TemporalContext;
}) {
  const model = await validateConfiguredGeminiModel();
  const response = await geminiFetchJson(
    generateContentUrl(model),
    {
      method: 'POST',
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: [
              'Interpreta el último mensaje para una máquina de estados de reservas.',
              'No decidas transiciones, no inventes datos y no respondas al cliente.',
              `Estado actual: ${input.status ?? 'sin_sesion'}.`,
              `Fecha local actual: ${input.temporal.localDate}. Zona: ${input.temporal.timezone}.`,
              'Devuelve exclusivamente el JSON solicitado.',
            ].join('\n'),
          }],
        },
        contents: [{ role: 'user', parts: [{ text: input.text.slice(0, 2000) }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 300,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            required: [...INTERPRETATION_KEYS],
            properties: {
              intent: { type: 'STRING', enum: [...BOOKING_INTENTS] },
              service_reference: { type: 'STRING', nullable: true },
              date_expression: { type: 'STRING', nullable: true },
              time_expression: { type: 'STRING', nullable: true },
              option_reference: { type: 'STRING', nullable: true, enum: [...OPTION_REFERENCES] },
              confirmation: { type: 'BOOLEAN', nullable: true },
              wants_human: { type: 'BOOLEAN' },
              confidence: { type: 'NUMBER', minimum: 0, maximum: 1 },
            },
          },
        },
      }),
    },
    'generate_content',
  ) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
  if (!raw) throw new Error('INTERPRETATION_INVALID');
  try {
    return parseBookingInterpretation(JSON.parse(raw));
  } catch {
    throw new Error('INTERPRETATION_INVALID');
  }
}

export function interpreterRuntimeConfigured() {
  const config = geminiConfig();
  return Boolean(config.apiKey && config.model);
}
