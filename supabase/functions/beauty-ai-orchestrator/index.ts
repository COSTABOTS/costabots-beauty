import {
  AI_HISTORY_LIMIT,
  beautyAiEnabled,
  markAiRun,
  requireServiceRoleRequest,
  sanitizedAiError,
} from '../_shared/beautyAi.ts';
import { evolutionFetch, json, serverClient } from '../_shared/beautyWhatsapp.ts';
import { generateBeautyReply } from './gemini.ts';
import { aiMessageReservation, responseStillAllowed, shouldProcessInbound } from './policy.ts';
import { executeTool } from './tools.ts';
import type { AiConversationContext, RecentMessage } from './types.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function markAttention(client: ReturnType<typeof serverClient>, context: AiConversationContext, reason: string) {
  await client.from('beauty_conversations').update({
    needs_attention: true,
    attention_reason: reason,
  }).eq('id', context.conversationId).eq('business_id', context.businessId).eq('mode', 'ai');
}

async function currentConversation(client: ReturnType<typeof serverClient>, context: AiConversationContext) {
  return client.from('beauty_conversations')
    .select('id,mode,assigned_user_id,whatsapp_connection_id')
    .eq('id', context.conversationId).eq('business_id', context.businessId).maybeSingle();
}

async function sendAiReply(
  client: ReturnType<typeof serverClient>,
  context: AiConversationContext,
  text: string,
) {
  // Final takeover check immediately before reserving and contacting Evolution.
  const current = await currentConversation(client, context);
  if (!current.data || !responseStillAllowed(current.data.mode, current.data.assigned_user_id)) {
    return { discarded: true as const };
  }

  const reservation = aiMessageReservation(
    context.runId,
    context.businessId,
    context.conversationId,
    text,
    new Date().toISOString(),
  );
  const reserved = await client.from('beauty_messages').insert(reservation).select('id,status').single();
  if (reserved.error?.code === '23505') {
    const existing = await client.from('beauty_messages').select('id,status')
      .eq('conversation_id', context.conversationId)
      .eq('client_request_id', reservation.client_request_id).maybeSingle();
    if (existing.data && ['sent', 'delivered', 'read'].includes(existing.data.status)) {
      return { discarded: false as const, messageId: existing.data.id, duplicate: true };
    }
    throw new Error('AI_MESSAGE_SEND_FAILED');
  }
  if (reserved.error || !reserved.data) throw new Error('AI_MESSAGE_SEND_FAILED');

  // Repeat the takeover check after reservation. If a human took control, the
  // unsent reservation is marked failed and no provider call is made.
  const beforeProvider = await currentConversation(client, context);
  if (!beforeProvider.data || !responseStillAllowed(beforeProvider.data.mode, beforeProvider.data.assigned_user_id)) {
    await client.from('beauty_messages').update({ status: 'failed' }).eq('id', reserved.data.id);
    return { discarded: true as const };
  }

  const connection = await client.from('beauty_whatsapp_connections')
    .select('instance_name,connection_status')
    .eq('id', beforeProvider.data.whatsapp_connection_id)
    .eq('business_id', context.businessId).single();
  if (connection.error || connection.data?.connection_status !== 'connected') {
    await client.from('beauty_messages').update({ status: 'failed' }).eq('id', reserved.data.id);
    throw new Error('AI_MESSAGE_SEND_FAILED');
  }
  const conversation = await client.from('beauty_conversations')
    .select('remote_phone_normalized').eq('id', context.conversationId).single();
  if (!conversation.data?.remote_phone_normalized) {
    await client.from('beauty_messages').update({ status: 'failed' }).eq('id', reserved.data.id);
    throw new Error('AI_MESSAGE_SEND_FAILED');
  }

  try {
    const response = await evolutionFetch(`/message/sendText/${encodeURIComponent(connection.data.instance_name)}`, {
      method: 'POST',
      body: JSON.stringify({ number: conversation.data.remote_phone_normalized, text }),
    }) as Record<string, unknown>;
    const actualId = String((response.key as Record<string, unknown> | undefined)?.id ?? `ai:${context.runId}`);
    await client.from('beauty_messages').update({
      provider_message_id: actualId,
      status: 'sent',
    }).eq('id', reserved.data.id);
    await client.from('beauty_conversations').update({
      last_message_at: new Date().toISOString(),
      last_message_preview: text.slice(0, 240),
    }).eq('id', context.conversationId).eq('business_id', context.businessId);
    return { discarded: false as const, messageId: reserved.data.id, duplicate: false };
  } catch {
    await client.from('beauty_messages').update({ status: 'failed' }).eq('id', reserved.data.id);
    throw new Error('AI_MESSAGE_SEND_FAILED');
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    requireServiceRoleRequest(request);
  } catch {
    return json(401, { error: 'SERVICE_ROLE_REQUIRED' });
  }

  let runId = '';
  try {
    const body = await request.json() as { runId?: unknown };
    runId = String(body.runId ?? '');
  } catch {
    return json(400, { error: 'INVALID_REQUEST' });
  }
  if (!UUID_PATTERN.test(runId)) return json(400, { error: 'INVALID_REQUEST' });

  const client = serverClient();
  if (!beautyAiEnabled()) {
    await markAiRun(client, runId, 'skipped', { error_code: 'AI_DISABLED' });
    return json(202, { accepted: true, processed: false });
  }

  const selected = await client.from('beauty_ai_runs').select('*').eq('id', runId).maybeSingle();
  if (!selected.data) return json(404, { error: 'AI_RUN_NOT_FOUND' });
  if (selected.data.status !== 'pending' || Number(selected.data.attempt_count) >= 3) {
    return json(200, { accepted: true, duplicate: true });
  }
  const claimed = await client.from('beauty_ai_runs').update({
    status: 'processing',
    attempt_count: Number(selected.data.attempt_count) + 1,
    started_at: new Date().toISOString(),
    error_code: null,
  }).eq('id', runId).eq('status', 'pending')
    .eq('attempt_count', selected.data.attempt_count).select('*').maybeSingle();
  if (!claimed.data) return json(200, { accepted: true, duplicate: true });

  const context: AiConversationContext = {
    runId,
    businessId: claimed.data.business_id,
    conversationId: claimed.data.conversation_id,
    inboundMessageId: claimed.data.inbound_message_id,
    contactName: null,
    language: 'es',
  };

  try {
    const conversation = await client.from('beauty_conversations')
      .select('mode,assigned_user_id,contact_name')
      .eq('id', context.conversationId).eq('business_id', context.businessId).single();
    const inbound = await client.from('beauty_messages')
      .select('direction,sender_type,text_content')
      .eq('id', context.inboundMessageId)
      .eq('conversation_id', context.conversationId)
      .eq('business_id', context.businessId).single();
    if (conversation.error || inbound.error || !conversation.data || !inbound.data) {
      throw new Error('CONVERSATION_NOT_ELIGIBLE');
    }
    context.contactName = conversation.data.contact_name;
    if (!shouldProcessInbound({
      aiEnabled: true,
      mode: conversation.data.mode,
      assignedUserId: conversation.data.assigned_user_id,
      direction: inbound.data.direction,
      senderType: inbound.data.sender_type,
    })) {
      await markAiRun(client, runId, 'skipped', { error_code: 'CONVERSATION_NOT_ELIGIBLE' });
      return json(200, { accepted: true, processed: false });
    }

    const business = await client.from('beauty_businesses')
      .select('default_language').eq('id', context.businessId).single();
    context.language = business.data?.default_language ?? 'es';
    const recent = await client.from('beauty_messages')
      .select('direction,sender_type,text_content,sent_at')
      .eq('conversation_id', context.conversationId)
      .order('sent_at', { ascending: false })
      .limit(AI_HISTORY_LIMIT);
    if (recent.error) throw new Error('AI_PROCESSING_FAILED');
    const messages = ((recent.data ?? []) as RecentMessage[]).reverse();

    const generated = await generateBeautyReply(
      messages,
      (call) => executeTool(client, context, call),
    );
    if (generated.handoffRequested || !generated.text) {
      await markAiRun(client, runId, 'skipped', { error_code: 'HUMAN_HANDOFF' });
      return json(200, { accepted: true, handoff: true });
    }

    const sent = await sendAiReply(client, context, generated.text);
    if (sent.discarded) {
      await markAiRun(client, runId, 'skipped', { error_code: 'MANUAL_TAKEOVER' });
      return json(200, { accepted: true, discarded: true });
    }
    await markAiRun(client, runId, 'completed', {
      response_message_id: sent.messageId,
      error_code: null,
    });
    return json(200, { accepted: true, completed: true, duplicate: sent.duplicate });
  } catch (error) {
    const code = sanitizedAiError(error);
    await markAiRun(client, runId, 'failed', { error_code: code });
    await markAttention(client, context, `AI_ERROR_${code}`);
    return json(200, { accepted: true, completed: false });
  }
});
