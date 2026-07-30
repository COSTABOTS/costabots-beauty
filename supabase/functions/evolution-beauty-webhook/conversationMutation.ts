export type ConversationMode = 'ai' | 'manual';

export type ExistingConversation = {
  id: string;
  mode: ConversationMode;
};

export type ConversationSharedValues = Record<string, unknown>;

export type ConversationMutation =
  | { kind: 'insert'; values: ConversationSharedValues & { mode: ConversationMode } }
  | { kind: 'update'; id: string; values: ConversationSharedValues };

function normalizedName(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

export function validInboundContactName(
  fromMe: boolean,
  candidate: unknown,
  forbiddenNames: Array<string | null | undefined> = [],
) {
  if (fromMe) return null;
  const value = String(candidate ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!value) return null;
  const normalized = normalizedName(value);
  if (['voce', 'you'].includes(normalized)) return null;
  if (forbiddenNames.some((name) => name && normalizedName(name) === normalized)) return null;
  return value;
}

/**
 * Inbound webhook messages own contact and last-message metadata, but not handoff state.
 * Only a message emitted by the connected WhatsApp account may reinforce manual
 * mode. An inbound message on an existing conversation must never release it.
 */
export function buildConversationMutation(
  existing: ExistingConversation | null,
  fromMe: boolean,
  sharedValues: ConversationSharedValues,
): ConversationMutation {
  if (!existing) {
    return {
      kind: 'insert',
      values: {
        ...sharedValues,
        mode: fromMe ? 'manual' : 'ai',
        needs_attention: false,
        attention_reason: null,
        assigned_user_id: null,
      },
    };
  }

  return {
    kind: 'update',
    id: existing.id,
    values: fromMe
      ? {
        ...sharedValues,
        mode: 'manual',
      }
      : sharedValues,
  };
}
