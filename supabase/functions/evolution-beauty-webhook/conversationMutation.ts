export type ConversationMode = 'ai' | 'manual';

export type ExistingConversation = {
  id: string;
  mode: ConversationMode;
};

export type ConversationSharedValues = Record<string, unknown>;

export type ConversationMutation =
  | { kind: 'insert'; values: ConversationSharedValues & { mode: ConversationMode } }
  | { kind: 'update'; id: string; values: ConversationSharedValues };

/**
 * Webhook messages own contact and last-message metadata, but not handoff state.
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
