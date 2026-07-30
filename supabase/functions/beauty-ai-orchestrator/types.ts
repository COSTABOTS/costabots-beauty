export type AiConversationContext = {
  runId: string;
  businessId: string;
  conversationId: string;
  inboundMessageId: string;
  contactName: string | null;
  language: string;
};

export type RecentMessage = {
  direction: 'inbound' | 'outbound';
  sender_type: 'customer' | 'human' | 'ai' | 'system';
  text_content: string | null;
  sent_at: string;
};

export type ToolCall = {
  name: 'get_business_info' | 'list_services' | 'get_availability' | 'request_human_handoff';
  args: Record<string, unknown>;
};

export type ToolExecutionResult = {
  value: Record<string, unknown>;
  handoffRequested?: boolean;
};
