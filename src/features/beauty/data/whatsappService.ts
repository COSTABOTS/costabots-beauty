import { supabase } from '../../../lib/supabaseClient';

export type WhatsAppConnectionStatus =
  | 'not_provisioned' | 'provisioning' | 'awaiting_qr' | 'connecting'
  | 'connected' | 'disconnected' | 'error';

export type WhatsAppConnection = {
  id?: string;
  status: WhatsAppConnectionStatus;
  phoneNumber: string | null;
  displayName: string | null;
  connectedAt: string | null;
  error: { code: string | null; message: string } | null;
};

export type WhatsAppConversation = {
  id: string;
  business_id: string;
  customer_id: string | null;
  remote_phone_normalized: string | null;
  contact_name: string | null;
  mode: 'ai' | 'manual';
  needs_attention: boolean;
  attention_reason: string | null;
  assigned_user_id: string | null;
  unread_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
};

export type WhatsAppMessage = {
  id: string;
  conversation_id: string;
  direction: 'inbound' | 'outbound';
  sender_type: 'customer' | 'human' | 'ai' | 'system';
  message_type: string;
  text_content: string | null;
  status: string;
  sent_at: string;
};

function functionError(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: unknown }).message);
    if (message.includes('Failed to fetch')) return new Error('No hay conexión con el servicio. Inténtalo de nuevo.');
  }
  return new Error(fallback);
}

type QueryResult<T> = {
  data: T;
  error: { code?: string; message?: string; status?: number } | null;
};

function isExpiredSessionError(error: QueryResult<unknown>['error']) {
  if (!error) return false;
  const code = String(error.code ?? '').toUpperCase();
  const message = String(error.message ?? '').toLowerCase();
  return error.status === 401
    || code === 'PGRST301'
    || code === 'PGRST303'
    || message.includes('jwt expired')
    || message.includes('invalid jwt');
}

async function authenticatedQuery<T>(
  operation: () => PromiseLike<QueryResult<T>>,
): Promise<QueryResult<T>> {
  const initial = await operation();
  if (!isExpiredSessionError(initial.error)) return initial;

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) return initial;
  return operation();
}

async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw functionError(error, 'No hemos podido completar la operación de WhatsApp.');
  if (data?.error) throw new Error(data.message ?? 'No hemos podido completar la operación de WhatsApp.');
  return data as T;
}

export async function loadWhatsAppConnection(businessId: string): Promise<WhatsAppConnection> {
  const { data, error } = await supabase.rpc('get_beauty_whatsapp_connection', { p_business_id: businessId });
  if (error) throw functionError(error, 'No hemos podido consultar la conexión.');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { status: 'not_provisioned', phoneNumber: null, displayName: null, connectedAt: null, error: null };
  return {
    id: row.id,
    status: row.connection_status,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    connectedAt: row.connected_at,
    error: row.last_error_message ? { code: row.last_error_code, message: row.last_error_message } : null,
  } as WhatsAppConnection;
}

export const provisionWhatsApp = (businessId: string) =>
  invoke<WhatsAppConnection>('beauty-whatsapp-provision', { businessId });
export const refreshWhatsAppStatus = (businessId: string) =>
  invoke<WhatsAppConnection>('beauty-whatsapp-status', { businessId });
export const requestWhatsAppQr = (businessId: string) =>
  invoke<{ qr: string; expiresInSeconds: number }>('beauty-whatsapp-qr', { businessId, authorizationConfirmed: true });
export const disconnectWhatsApp = (businessId: string) =>
  invoke<WhatsAppConnection>('beauty-whatsapp-disconnect', { businessId, confirmed: true });

export async function loadWhatsAppConversations(businessId: string) {
  const { data, error } = await authenticatedQuery(() =>
    supabase.from('beauty_conversations').select('*')
      .eq('business_id', businessId).eq('active', true)
      .order('last_message_at', { ascending: false, nullsFirst: false })
  );
  if (error) throw functionError(error, 'No hemos podido cargar las conversaciones.');
  return (data ?? []) as WhatsAppConversation[];
}

export async function loadWhatsAppMessages(conversationId: string, limit: number) {
  const { data, error } = await authenticatedQuery(() =>
    supabase.from('beauty_messages')
      .select('id,conversation_id,direction,sender_type,message_type,text_content,status,sent_at')
      .eq('conversation_id', conversationId).order('sent_at', { ascending: false }).limit(limit)
  );
  if (error) throw functionError(error, 'No hemos podido cargar los mensajes.');
  return ((data ?? []) as WhatsAppMessage[]).reverse();
}

export async function takeConversation(conversationId: string) {
  const { error } = await supabase.rpc('take_beauty_conversation', { p_conversation_id: conversationId });
  if (error) throw functionError(error, 'Otra persona ya está atendiendo esta conversación.');
}

export async function releaseConversation(conversationId: string) {
  const { error } = await supabase.rpc('release_beauty_conversation', { p_conversation_id: conversationId });
  if (error) throw functionError(error, 'No hemos podido preparar la conversación para la IA.');
}

export async function markConversationRead(conversationId: string) {
  const { error } = await supabase.rpc('mark_beauty_conversation_read', { p_conversation_id: conversationId });
  if (error) throw functionError(error, 'No hemos podido marcar la conversación como leída.');
}

export const sendWhatsAppMessage = (businessId: string, conversationId: string, text: string) =>
  invoke<{ id: string; status: string }>('beauty-whatsapp-send-message', {
    businessId, conversationId, text,
    clientRequestId: crypto.randomUUID(),
  });
