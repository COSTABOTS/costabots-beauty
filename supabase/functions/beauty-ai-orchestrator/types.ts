export type AiConversationContext = {
  runId: string;
  businessId: string;
  conversationId: string;
  inboundMessageId: string;
  contactName: string | null;
  language: string;
  normalizedDate: string | null;
};

export type RecentMessage = {
  direction: 'inbound' | 'outbound';
  sender_type: 'customer' | 'human' | 'ai' | 'system';
  text_content: string | null;
  sent_at: string;
};

export type ToolCall = {
  name: 'get_business_info' | 'list_services';
  args: Record<string, unknown>;
};

export type ToolExecutionResult = {
  value: Record<string, unknown>;
  handoffRequested?: boolean;
};

export type ToolErrorCategory =
  | 'invalid_date'
  | 'date_out_of_range'
  | 'no_availability'
  | 'service_not_resolved'
  | 'tool_internal_error';

export class BeautyToolError extends Error {
  readonly category: ToolErrorCategory;
  readonly toolName: ToolCall['name'] | 'get_availability';
  readonly normalizedDate: string | null;

  constructor(
    category: ToolErrorCategory,
    toolName: ToolCall['name'] | 'get_availability',
    normalizedDate: string | null = null,
  ) {
    super('AI_TOOL_FAILED');
    this.name = 'BeautyToolError';
    this.category = category;
    this.toolName = toolName;
    this.normalizedDate = normalizedDate;
  }
}
