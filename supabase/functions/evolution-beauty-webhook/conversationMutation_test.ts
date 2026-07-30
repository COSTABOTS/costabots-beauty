import {
  buildConversationMutation,
  type ConversationMode,
  type ConversationMutation,
} from './conversationMutation.ts';

type State = {
  id: string;
  mode: ConversationMode;
  assigned_user_id: string | null;
  needs_attention: boolean;
  last_message_preview?: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function apply(state: State | null, mutation: ConversationMutation): State {
  const base = state ?? {
    id: 'conversation-1',
    mode: 'ai' as const,
    assigned_user_id: null,
    needs_attention: false,
  };
  return { ...base, ...mutation.values } as State;
}

Deno.test('conversation mode changes only through the allowed domain transitions', () => {
  // A. A new inbound conversation starts under AI ownership.
  let state = apply(null, buildConversationMutation(null, false, { last_message_preview: 'inbound' }));
  assert(state.mode === 'ai', 'new inbound conversation must start in ai mode');

  // B. Mirrors take_beauty_conversation.
  state = { ...state, mode: 'manual', assigned_user_id: 'manager-1', needs_attention: false };
  assert(state.mode === 'manual', 'taking a conversation must set manual mode');

  // C. A later inbound webhook updates metadata without owning mode.
  const inbound = buildConversationMutation(
    { id: state.id, mode: state.mode },
    false,
    { last_message_preview: 'later inbound' },
  );
  assert(!Object.hasOwn(inbound.values, 'mode'), 'existing inbound update must omit mode');
  state = apply(state, inbound);
  assert(state.mode === 'manual', 'inbound webhook must preserve manual mode');

  // D. A human outbound webhook reinforces manual mode.
  state = apply(
    state,
    buildConversationMutation(
      { id: state.id, mode: state.mode },
      true,
      { last_message_preview: 'human outbound' },
    ),
  );
  assert(state.mode === 'manual', 'human outbound message must preserve manual mode');
  assert(state.needs_attention === false, 'human outbound must not change attention state');

  // E. sent/delivered/read events update messages only, so conversation is unchanged.
  const beforeStatus = { ...state };
  state = { ...state };
  assert(JSON.stringify(state) === JSON.stringify(beforeStatus), 'status event must not mutate conversation');

  // F. Reprocessing the same inbound mutation remains safe.
  state = apply(state, inbound);
  assert(state.mode === 'manual', 'idempotent reprocessing must preserve manual mode');

  // G. Mirrors release_beauty_conversation, the sole manual -> ai transition.
  state = {
    ...state,
    mode: 'ai',
    assigned_user_id: null,
    needs_attention: false,
  };
  assert(state.mode === 'ai' && state.assigned_user_id === null, 'release must return control to ai');

  // H. A normal inbound event after release preserves mode and updates metadata.
  state = apply(
    state,
    buildConversationMutation(
      { id: state.id, mode: state.mode },
      false,
      { last_message_preview: 'after release' },
    ),
  );
  assert(state.mode === 'ai', 'normal event after release must preserve ai mode');
  assert(state.last_message_preview === 'after release', 'normal metadata must still update');
});
