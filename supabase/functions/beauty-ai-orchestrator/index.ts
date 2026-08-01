import {
  AI_HISTORY_LIMIT,
  beautyAiEnabled,
  markAiRun,
  requireServiceRoleRequest,
  sanitizedAiFailure,
} from '../_shared/beautyAi.ts';
import { evolutionFetch, json, serverClient } from '../_shared/beautyWhatsapp.ts';
import {
  generateBeautyReply,
  validateConfiguredGeminiModel,
  validateMinimalGenerateContent,
} from './gemini.ts';
import { processBookingFlow } from './bookingFlow.ts';
import { completeHandoff, loadActiveBookingSession } from './bookingSessionRepository.ts';
import { buildTemporalContext } from './dateResolution.ts';
import {
  aiMessageReservation,
  canClaimAiRun,
  responseStillAllowed,
  runMatchesLatestInbound,
  shouldProcessInbound,
} from './policy.ts';
import { executeTool } from './tools.ts';
import type { AiConversationContext, RecentMessage } from './types.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function markAttention(client: ReturnType<typeof serverClient>, context: AiConversationContext, reason: string) {
  await client.from('beauty_conversations').update({
    needs_attention: true,
    attention_reason: reason,
  }).eq('id', context.conversationId).eq('business_id', context.businessId).eq('mode', 'ai');
}

async function completeTechnicalHandoff(
  client: ReturnType<typeof serverClient>,
  context: AiConversationContext,
  responseMessageId: string,
  reason: string,
) {
  const session = await loadActiveBookingSession(client, context.businessId, context.conversationId);
  if (session) {
    try {
      await completeHandoff(client, session, responseMessageId, 'unsupported');
      return;
    } catch {
      // A concurrent session update must not leave the conversation in an AI loop.
    }
  }
  await client.from('beauty_conversations').update({
    mode: 'manual',
    assigned_user_id: null,
    needs_attention: true,
    attention_reason: reason,
  }).eq('id', context.conversationId).eq('business_id', context.businessId).eq('mode', 'ai');
}

async function currentConversation(client: ReturnType<typeof serverClient>, context: AiConversationContext) {
  return client.from('beauty_conversations')
    .select('id,mode,assigned_user_id,whatsapp_connection_id')
    .eq('id', context.conversationId).eq('business_id', context.businessId).maybeSingle();
}

async function newestInbound(client: ReturnType<typeof serverClient>, context: AiConversationContext) {
  return client.from('beauty_messages').select('id')
    .eq('conversation_id', context.conversationId)
    .eq('business_id', context.businessId)
    .eq('direction', 'inbound')
    .eq('sender_type', 'customer')
    .order('sent_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function sendAiReply(
  client: ReturnType<typeof serverClient>,
  context: AiConversationContext,
  text: string,
) {
  const latestBeforeReservation = await newestInbound(client, context);
  if (!runMatchesLatestInbound(context.inboundMessageId, latestBeforeReservation.data?.id ?? null)) {
    return {
      discarded: true as const,
      reason: 'newer_inbound' as const,
      supersededBy: latestBeforeReservation.data?.id ?? null,
    };
  }
  // Final takeover check immediately before reserving and contacting Evolution.
  const current = await currentConversation(client, context);
  if (!current.data || !responseStillAllowed(current.data.mode, current.data.assigned_user_id)) {
    return { discarded: true as const, reason: 'manual_takeover' as const, supersededBy: null };
  }

  const reservation = aiMessageReservation(
    context.runId,
    context.businessId,
    context.conversationId,
    text,
    new Date().toISOString(),
  );
  const reserved = await client.from('beauty_messages').insert(reservation).select('id,status').single();
  if (reserved.error?.message?.includes('AI_RESPONSE_SUPERSEDED')) {
    const latest = await newestInbound(client, context);
    return {
      discarded: true as const,
      reason: 'newer_inbound' as const,
      supersededBy: latest.data?.id ?? null,
    };
  }
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
  const latestBeforeProvider = await newestInbound(client, context);
  if (!runMatchesLatestInbound(context.inboundMessageId, latestBeforeProvider.data?.id ?? null)) {
    await client.from('beauty_messages').update({ status: 'failed' }).eq('id', reserved.data.id);
    return {
      discarded: true as const,
      reason: 'newer_inbound' as const,
      supersededBy: latestBeforeProvider.data?.id ?? null,
    };
  }
  if (!beforeProvider.data || !responseStillAllowed(beforeProvider.data.mode, beforeProvider.data.assigned_user_id)) {
    await client.from('beauty_messages').update({ status: 'failed' }).eq('id', reserved.data.id);
    return { discarded: true as const, reason: 'manual_takeover' as const, supersededBy: null };
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
  let action = '';
  try {
    const body = await request.json() as { runId?: unknown; action?: unknown };
    runId = String(body.runId ?? '');
    action = String(body.action ?? '');
  } catch {
    return json(400, { error: 'INVALID_REQUEST' });
  }
  if (action === 'validate_model_metadata') {
    try {
      await validateConfiguredGeminiModel();
      return json(200, {
        valid: true,
        phase: 'model_metadata',
        upstream_http_status: 200,
        error_category: null,
        error_code: null,
        retryable: false,
      });
    } catch (error) {
      const failure = sanitizedAiFailure(error);
      return json(200, { valid: false, ...failure });
    }
  }
  if (action === 'validate_generate_content') {
    try {
      await validateMinimalGenerateContent();
      return json(200, {
        valid: true,
        phase: 'generate_content',
        upstream_http_status: 200,
        error_category: null,
        error_code: null,
        retryable: false,
      });
    } catch (error) {
      const failure = sanitizedAiFailure(error);
      return json(200, { valid: false, ...failure });
    }
  }
  if (!UUID_PATTERN.test(runId)) return json(400, { error: 'INVALID_REQUEST' });

  const client = serverClient();
  if (!beautyAiEnabled()) {
    await markAiRun(client, runId, 'skipped', { error_code: 'AI_DISABLED' });
    return json(202, { accepted: true, processed: false });
  }

  const selected = await client.from('beauty_ai_runs').select('*').eq('id', runId).maybeSingle();
  if (!selected.data) return json(404, { error: 'AI_RUN_NOT_FOUND' });
  if (!canClaimAiRun(selected.data.status, Number(selected.data.attempt_count))) {
    return json(200, { accepted: true, duplicate: true });
  }
  const claimed = await client.from('beauty_ai_runs').update({
    status: 'processing',
    attempt_count: Number(selected.data.attempt_count) + 1,
    started_at: new Date().toISOString(),
    error_code: null,
    error_phase: null,
    upstream_http_status: null,
    error_category: null,
    retryable: null,
    tool_name: null,
    normalized_date: null,
    tool_error_category: null,
    superseded_by_inbound_message_id: null,
    response_disposition: null,
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
    normalizedDate: null,
  };

  try {
    const conversation = await client.from('beauty_conversations')
      .select('mode,assigned_user_id,contact_name')
      .eq('id', context.conversationId).eq('business_id', context.businessId).single();
    const inbound = await client.from('beauty_messages')
      .select('direction,sender_type,text_content,sent_at')
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

    const latestAtStart = await newestInbound(client, context);
    if (!runMatchesLatestInbound(context.inboundMessageId, latestAtStart.data?.id ?? null)) {
      await markAiRun(client, runId, 'skipped', {
        error_code: 'SUPERSEDED_BY_NEWER_INBOUND',
        superseded_by_inbound_message_id: latestAtStart.data?.id ?? null,
        response_disposition: 'skipped_newer_inbound',
      });
      return json(200, { accepted: true, superseded: true });
    }

    const business = await client.from('beauty_businesses')
      .select('default_language,timezone').eq('id', context.businessId).single();
    if (business.error || !business.data?.timezone) throw new Error('AI_PROCESSING_FAILED');
    context.language = business.data?.default_language ?? 'es';
    const temporalContext = buildTemporalContext(new Date(), business.data.timezone);
    const recent = await client.from('beauty_messages')
      .select('id,direction,sender_type,text_content,sent_at')
      .eq('conversation_id', context.conversationId)
      .order('sent_at', { ascending: false })
      .limit(AI_HISTORY_LIMIT);
    if (recent.error) throw new Error('AI_PROCESSING_FAILED');
    const messages = ((recent.data ?? []) as RecentMessage[]).reverse();

    const booking = await processBookingFlow({
      client,
      context,
      text: inbound.data.text_content ?? '',
      temporal: temporalContext,
      nowIso: new Date().toISOString(),
      sendReply: (text) => sendAiReply(client, context, text),
    });
    if (booking.handled) {
      if (booking.sent.discarded) {
        await markAiRun(client, runId, 'skipped', {
          error_code: booking.sent.reason === 'newer_inbound'
            ? 'SUPERSEDED_BY_NEWER_INBOUND'
            : 'MANUAL_TAKEOVER',
          response_disposition: booking.sent.reason === 'newer_inbound'
            ? 'skipped_newer_inbound'
            : 'failed_no_response',
        });
        return json(200, { accepted: true, discarded: true });
      }
      if (booking.handoff && booking.session && booking.sent.messageId) {
        // The provider accepted the controlled warning before manual mode is set.
        await completeHandoff(
          client,
          booking.session,
          booking.sent.messageId,
          booking.handoffReason ?? 'booking_confirmation',
        );
      }
      await markAiRun(client, runId, 'completed', {
        response_message_id: booking.sent.messageId,
        response_disposition: booking.handoff ? 'handoff' : 'sent',
      });
      return json(200, { accepted: true, booking: true, handoff: booking.handoff });
    }

    // The free-form generator is information-only. Booking state, availability,
    // selection and handoff are exclusively coordinated by processBookingFlow.
    const generated = await generateBeautyReply(
      messages,
      async (call) => {
        await markAiRun(client, runId, 'processing', { tool_name: call.name });
        try {
          return await executeTool(client, context, call);
        } catch (error) {
          throw error;
        }
      },
      temporalContext,
    );
    if (!generated.text) throw new Error('GEMINI_RESPONSE_INVALID');

    const sent = await sendAiReply(client, context, generated.text);
    if (sent.discarded) {
      await markAiRun(client, runId, 'skipped', {
        error_code: sent.reason === 'newer_inbound' ? 'SUPERSEDED_BY_NEWER_INBOUND' : 'MANUAL_TAKEOVER',
        superseded_by_inbound_message_id: sent.supersededBy,
        response_disposition: sent.reason === 'newer_inbound' ? 'skipped_newer_inbound' : 'failed_no_response',
      });
      return json(200, { accepted: true, discarded: true });
    }
    await markAiRun(client, runId, 'completed', {
      response_message_id: sent.messageId,
      error_code: null,
      response_disposition: 'sent',
    });
    return json(200, { accepted: true, completed: true, duplicate: sent.duplicate });
  } catch (error) {
    const failure = sanitizedAiFailure(error);
    try {
      const fallback = await sendAiReply(
        client,
        context,
        'Ahora mismo no puedo completar esa consulta. Una persona del negocio la revisará contigo.',
      );
      if (!fallback.discarded && fallback.messageId) {
        await markAiRun(client, runId, 'failed', {
          ...failure,
          response_message_id: fallback.messageId,
          response_disposition: 'sent',
        });
        await completeTechnicalHandoff(
          client,
          context,
          fallback.messageId,
          `AI_ERROR_${failure.error_code}`,
        );
        return json(200, { accepted: true, completed: false, fallback: true });
      }
      if (fallback.discarded) {
        await markAiRun(client, runId, 'skipped', {
          error_code: fallback.reason === 'newer_inbound'
            ? 'SUPERSEDED_BY_NEWER_INBOUND'
            : 'MANUAL_TAKEOVER',
          response_disposition: fallback.reason === 'newer_inbound'
            ? 'skipped_newer_inbound'
            : 'failed_no_response',
        });
        return json(200, { accepted: true, discarded: true });
      }
    } catch {
      // The original sanitized failure is preserved below. No raw upstream
      // payload, prompt or provider response is stored.
    }
    await markAiRun(client, runId, 'failed', {
      ...failure,
      response_disposition: 'failed_no_response',
    });
    await markAttention(client, context, `AI_ERROR_${failure.error_code}`);
    return json(200, { accepted: true, completed: false });
  }
});
