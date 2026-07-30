export type ConversationEligibility = {
  aiEnabled: boolean;
  mode: 'ai' | 'manual';
  assignedUserId: string | null;
  direction: 'inbound' | 'outbound';
  senderType: 'customer' | 'human' | 'ai' | 'system';
};

export function shouldProcessInbound(input: ConversationEligibility) {
  return input.aiEnabled
    && input.mode === 'ai'
    && input.assignedUserId === null
    && input.direction === 'inbound'
    && input.senderType === 'customer';
}

export function responseStillAllowed(mode: 'ai' | 'manual', assignedUserId: string | null) {
  return mode === 'ai' && assignedUserId === null;
}

export function internalBusinessId(runBusinessId: string, _toolArguments: Record<string, unknown>) {
  return runBusinessId;
}

export function safeHandoffReason(value: unknown) {
  const allowed = new Set(['requested', 'complaint', 'urgent', 'confused', 'unsupported']);
  const normalized = String(value ?? '').toLowerCase();
  return allowed.has(normalized) ? normalized : 'unsupported';
}

export function aiMessageReservation(
  runId: string,
  businessId: string,
  conversationId: string,
  text: string,
  now: string,
) {
  return {
    business_id: businessId,
    conversation_id: conversationId,
    provider_message_id: `ai:${runId}`,
    client_request_id: `ai-run-${runId}`,
    direction: 'outbound' as const,
    sender_type: 'ai' as const,
    message_type: 'text' as const,
    text_content: text,
    status: 'pending' as const,
    sent_at: now,
  };
}
