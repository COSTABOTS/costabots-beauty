import { evolutionFetch, json, serverClient } from '../_shared/beautyWhatsapp.ts';
import {
  buildDayBeforeReminder,
  isRemindersDryRun,
  reminderClientRequestId,
  retryDisposition,
  type ReminderDispatchContext,
} from './reminderDispatcher.ts';

const MAX_BATCH_SIZE = 25;

type ClaimedReminder = {
  id: string;
  business_id: string;
  appointment_id: string;
  schedule_revision: number;
  attempt_count: number;
  lock_token: string;
};

type PreparedReminder = {
  outcome: 'ready' | 'retry' | 'skipped' | 'cancelled' | 'not_claimed';
  error_code: string | null;
  payload: ReminderDispatchContext | null;
};

async function secureEquals(left: string, right: string) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

function batchSize(value: unknown) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 10;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, parsed));
}

async function settle(
  client: ReturnType<typeof serverClient>,
  reminder: ClaimedReminder,
  input: {
    status: 'pending' | 'sent' | 'skipped' | 'cancelled' | 'failed';
    skipReason?: string | null;
    errorCode?: string | null;
    nextAttemptAt?: string | null;
    messageId?: string | null;
    dryRun?: boolean;
  },
) {
  const result = await client.rpc('settle_beauty_appointment_reminder_dispatch', {
    p_reminder_id: reminder.id,
    p_business_id: reminder.business_id,
    p_lock_token: reminder.lock_token,
    p_schedule_revision: reminder.schedule_revision,
    p_status: input.status,
    p_skip_reason: input.skipReason ?? null,
    p_error_code: input.errorCode ?? null,
    p_next_attempt_at: input.nextAttemptAt ?? null,
    p_message_id: input.messageId ?? null,
    p_dry_run: input.dryRun ?? false,
  });
  if (result.error) throw new Error('REMINDER_SETTLE_FAILED');
  return result.data === true;
}

async function reserveReminderMessage(
  client: ReturnType<typeof serverClient>,
  reminder: ClaimedReminder,
  context: ReminderDispatchContext,
  text: string,
) {
  const clientRequestId = reminderClientRequestId(reminder.appointment_id, reminder.schedule_revision);
  const existing = await client.from('beauty_messages').select('id,status')
    .eq('business_id', reminder.business_id)
    .eq('conversation_id', context.conversationId)
    .eq('client_request_id', clientRequestId).maybeSingle();
  if (existing.error) throw new Error('REMINDER_MESSAGE_LOOKUP_FAILED');
  if (existing.data) return { kind: 'existing' as const, id: existing.data.id, status: existing.data.status };

  const inserted = await client.from('beauty_messages').insert({
    business_id: reminder.business_id,
    conversation_id: context.conversationId,
    provider_message_id: `reminder:${clientRequestId}`,
    client_request_id: clientRequestId,
    direction: 'outbound',
    sender_type: 'system',
    message_type: 'text',
    text_content: text,
    status: 'pending',
    sent_at: new Date().toISOString(),
  }).select('id,status').single();
  if (inserted.error?.code === '23505') {
    const concurrent = await client.from('beauty_messages').select('id,status')
      .eq('conversation_id', context.conversationId).eq('client_request_id', clientRequestId).single();
    if (!concurrent.error && concurrent.data) return { kind: 'existing' as const, id: concurrent.data.id, status: concurrent.data.status };
  }
  if (inserted.error || !inserted.data) throw new Error('REMINDER_MESSAGE_RESERVATION_FAILED');
  return { kind: 'reserved' as const, id: inserted.data.id, status: inserted.data.status, context };
}

async function processReminder(client: ReturnType<typeof serverClient>, reminder: ClaimedReminder, dryRun: boolean) {
  const prepared = await client.rpc('prepare_beauty_appointment_reminder_dispatch', {
    p_reminder_id: reminder.id,
    p_business_id: reminder.business_id,
    p_lock_token: reminder.lock_token,
    p_schedule_revision: reminder.schedule_revision,
  });
  if (prepared.error) throw new Error('REMINDER_PREPARE_FAILED');
  const state = (prepared.data?.[0] ?? null) as PreparedReminder | null;
  if (!state || state.outcome === 'not_claimed') return { result: 'not_claimed' };
  if (state.outcome === 'cancelled') {
    await settle(client, reminder, { status: 'cancelled', errorCode: state.error_code });
    return { result: 'cancelled', code: state.error_code };
  }
  if (state.outcome === 'skipped') {
    await settle(client, reminder, { status: 'skipped', skipReason: state.error_code, errorCode: state.error_code });
    return { result: 'skipped', code: state.error_code };
  }
  if (state.outcome === 'retry') {
    const retry = retryDisposition(reminder.attempt_count, state.error_code ?? 'REMINDER_RETRY');
    await settle(client, reminder, {
      status: retry.status,
      errorCode: retry.errorCode,
      nextAttemptAt: retry.delayMinutes === null ? null : new Date(Date.now() + retry.delayMinutes * 60_000).toISOString(),
    });
    return { result: retry.status, code: retry.errorCode };
  }
  if (!state.payload) throw new Error('REMINDER_PREPARE_PAYLOAD_INVALID');

  const text = buildDayBeforeReminder(state.payload);
  if (dryRun) {
    await settle(client, reminder, { status: 'pending', errorCode: 'DRY_RUN', dryRun: true });
    console.log(JSON.stringify({ event: 'REMINDER_DRY_RUN', reminderId: reminder.id, businessId: reminder.business_id, scheduleRevision: reminder.schedule_revision, text }));
    return { result: 'dry_run' };
  }

  const reservation = await reserveReminderMessage(client, reminder, state.payload, text);
  if (reservation.kind === 'existing') {
    if (['sent', 'delivered', 'read'].includes(reservation.status)) {
      await settle(client, reminder, { status: 'sent', messageId: reservation.id });
      return { result: 'already_sent' };
    }
    await settle(client, reminder, { status: 'failed', errorCode: 'DELIVERY_UNKNOWN', messageId: reservation.id });
    return { result: 'delivery_unknown' };
  }

  try {
    const response = await evolutionFetch(`/message/sendText/${encodeURIComponent(state.payload.instanceName)}`, {
      method: 'POST', body: JSON.stringify({ number: state.payload.phone, text }),
    }) as Record<string, unknown>;
    const providerId = String((response.key as Record<string, unknown> | undefined)?.id ?? '');
    if (!providerId) throw new Error('DELIVERY_UNKNOWN');
    const updated = await client.from('beauty_messages').update({ provider_message_id: providerId, status: 'sent' })
      .eq('id', reservation.id).eq('business_id', reminder.business_id);
    if (updated.error) throw new Error('REMINDER_MESSAGE_MARK_SENT_FAILED');
    await settle(client, reminder, { status: 'sent', messageId: reservation.id });
    return { result: 'sent' };
  } catch {
    await client.from('beauty_messages').update({ status: 'failed' }).eq('id', reservation.id).eq('business_id', reminder.business_id);
    await settle(client, reminder, { status: 'failed', errorCode: 'DELIVERY_UNKNOWN', messageId: reservation.id });
    return { result: 'delivery_unknown' };
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  const expectedSecret = Deno.env.get('REMINDERS_CRON_SECRET');
  const suppliedSecret = request.headers.get('x-reminder-cron-secret') ?? '';
  if (!expectedSecret || !await secureEquals(suppliedSecret, expectedSecret)) return json(401, { error: 'CRON_SECRET_REQUIRED' });
  const dryRun = isRemindersDryRun(Deno.env.get('REMINDERS_DRY_RUN'));
  const body = await request.json().catch(() => ({})) as { batchSize?: unknown };
  const client = serverClient();
  try {
    const claim = await client.rpc('claim_beauty_appointment_reminders', { p_limit: batchSize(body.batchSize) });
    if (claim.error) throw new Error('REMINDER_CLAIM_FAILED');
    const results = [];
    for (const reminder of (claim.data ?? []) as ClaimedReminder[]) results.push(await processReminder(client, reminder, dryRun));
    return json(200, { dryRun, claimed: (claim.data ?? []).length, results });
  } catch (error) {
    console.error(JSON.stringify({ event: 'REMINDER_DISPATCH_FAILED', code: error instanceof Error ? error.message : 'UNKNOWN' }));
    return json(500, { error: 'REMINDER_DISPATCH_FAILED' });
  }
});
