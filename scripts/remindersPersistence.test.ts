import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20261010110037_appointment_reminders_foundation.sql', import.meta.url);
const conversationMigrationUrl = new URL('../supabase/migrations/20261011100038_booking_reminder_consent_conversation.sql', import.meta.url);
const multiMessageMigrationUrl = new URL('../supabase/migrations/20261011120039_ai_multimessage_idempotency.sql', import.meta.url);
const dispatchMigrationUrl = new URL('../supabase/migrations/20261011130040_appointment_reminder_dispatch.sql', import.meta.url);

async function migration() {
  return readFile(migrationUrl, 'utf8');
}

async function conversationMigration() {
  return readFile(conversationMigrationUrl, 'utf8');
}

async function multiMessageMigration() {
  return readFile(multiMessageMigrationUrl, 'utf8');
}

async function dispatchMigration() {
  return readFile(dispatchMigrationUrl, 'utf8');
}

test('historical reminder boolean is migrated conservatively to tri-state consent', async () => {
  const sql = await migration();
  assert.match(sql, /reminder_consent_status text not null default 'unknown'/i);
  assert.match(sql, /case when reminder_consent then 'granted' else 'unknown' end/i);
  assert.doesNotMatch(sql, /when not reminder_consent then 'denied'/i);
  assert.match(sql, /new\.reminder_consent := new\.reminder_consent_status = 'granted'/i);
});

test('legacy checkbox transitions remain coherent with the tri-state source of truth', async () => {
  const sql = await migration();
  assert.match(sql, /new\.reminder_consent is distinct from old\.reminder_consent/i);
  assert.match(sql, /case when new\.reminder_consent then 'granted' else 'denied' end/i);
  assert.match(sql, /new\.reminder_consent_decided_at := case[\s\S]*else coalesce\(new\.reminder_consent_decided_at, now\(\)\)/i);
});

test('reminder outbox is server-only, constrained, and claim-indexed', async () => {
  const sql = await migration();
  assert.match(sql, /create table if not exists public\.beauty_appointment_reminders/i);
  assert.match(sql, /unique \(appointment_id, kind\)/i);
  assert.match(sql, /status in \('awaiting_consent', 'pending', 'processing', 'sent', 'skipped', 'cancelled', 'failed'\)/i);
  assert.match(sql, /beauty_appointment_reminders_claim_idx/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /force row level security/i);
  assert.match(sql, /revoke all privileges on table public\.beauty_appointment_reminders from public, anon, authenticated/i);
  assert.match(sql, /revoke all on function public\.sync_beauty_customer_reminder_consent\(\) from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update on table public\.beauty_appointment_reminders to service_role/i);
  assert.match(sql, /foreign key \(appointment_id, business_id\)[\s\S]*references public\.appointments\(id, business_id\)/i);
  assert.match(sql, /v_conversation_business_id is distinct from p_business_id/i);
});

test('confirmation, rescheduling, and cancellation invoke one shared transactional reminder helper', async () => {
  const sql = await migration();
  assert.match(sql, /create or replace function public\.sync_beauty_appointment_reminder/i);
  assert.match(sql, /perform public\.sync_beauty_appointment_reminder\(p_business_id, v_appointment\.id, p_conversation_id, false\)/i);
  assert.match(sql, /revoke all on function public\.confirm_beauty_booking_session\(uuid, uuid, uuid, uuid, integer\)[\s\S]*grant execute on function public\.confirm_beauty_booking_session[\s\S]*to service_role/i);
  assert.match(sql, /if v_rescheduled or v_staff_changed or v_services_changed then perform public\.sync_beauty_appointment_reminder/i);
  assert.match(sql, /perform public\.cancel_beauty_appointment_reminders\(p_business_id, p_appointment_id\)/i);
  assert.match(sql, /schedule_revision = schedule_revision \+ 1/i);
  assert.match(sql, /locked_at = null,[\s\S]*lock_token = null/i);
});

test('reminder state selection is explicit for granted, unknown, denied, and late appointments', async () => {
  const sql = await migration();
  assert.match(sql, /v_appointment\.starts_at <= now\(\) \+ interval '24 hours'/i);
  assert.match(sql, /v_consent = 'denied'[\s\S]*v_status := 'skipped'; v_skip_reason := 'CONSENT_DENIED'[\s\S]*v_appointment\.starts_at <= now\(\) \+ interval '24 hours'[\s\S]*v_status := 'skipped'; v_skip_reason := 'TOO_LATE'/i);
  assert.match(sql, /v_consent = 'granted'[\s\S]*v_status := 'pending'/i);
  assert.match(sql, /v_consent = 'unknown'[\s\S]*v_status := 'awaiting_consent'/i);
  assert.match(sql, /and status <> 'sent'/i);
  assert.doesNotMatch(sql, /p_starts_at\s*-\s*interval '24 hours'/i);
  assert.match(sql, /\(\(p_starts_at at time zone p_timezone\)::date - 1\)/i);
});

test('cancellation never mutates a sent reminder, while schedule changes reset the old claim', async () => {
  const sql = await migration();
  assert.match(sql, /status = 'cancelled', cancelled_at = now\(\), next_attempt_at = null,[\s\S]*and status <> 'sent'/i);
  assert.match(sql, /schedule_revision = schedule_revision \+ 1,[\s\S]*status = v_status,[\s\S]*locked_at = null,[\s\S]*lock_token = null/i);
});

test('conversation phone storage is canonically E.164 without guessing a country code', async () => {
  const webhook = await readFile(new URL('../supabase/functions/evolution-beauty-webhook/index.ts', import.meta.url), 'utf8');
  const sql = await migration();
  assert.match(webhook, /return `\+\$\{digits\}`/);
  assert.doesNotMatch(webhook, /return `\+34\$\{digits\}`/);
  assert.doesNotMatch(sql, /update public\.beauty_conversations[\s\S]*remote_phone_normalized/i);
  assert.match(sql, /Historical conversation identities are intentionally left untouched/i);
  assert.match(sql, /public\.normalize_beauty_customer_phone\(v_conversation\.remote_phone_normalized\)/i);
});

test('conversational consent consumes an exact prompt marker and preserves tenant boundaries', async () => {
  const sql = await conversationMigration();
  assert.match(sql, /resolve_beauty_reminder_consent_response/i);
  assert.match(sql, /last_response_message_id = p_prompt_message_id/i);
  assert.match(sql, /text_content = '¿Quieres que te recuerde tus citas por WhatsApp el día anterior\?'/i);
  assert.match(sql, /v_prompt_sent_at < now\(\) - interval '30 minutes'/i);
  assert.match(sql, /reminder\.conversation_id = p_conversation_id/i);
  assert.match(sql, /customer\.business_id = appointment\.business_id/i);
  assert.match(sql, /where id = p_run_id and business_id = p_business_id/i);
  assert.match(sql, /p_choice not in \('granted', 'denied', 'defer'\)/i);
  assert.match(sql, /reminder_consent_status = 'granted'/i);
  assert.match(sql, /reminder_consent_status = 'denied'/i);
  assert.match(sql, /status = 'pending'/i);
  assert.match(sql, /status = 'skipped', skip_reason = 'CONSENT_DENIED'/i);
  assert.match(sql, /revoke all on function public\.resolve_beauty_reminder_consent_response[\s\S]*from public, anon, authenticated/i);
});

test('consent response is consumed before the active booking parser', async () => {
  const flow = await readFile(new URL('../supabase/functions/beauty-ai-orchestrator/bookingFlow.ts', import.meta.url), 'utf8');
  const consentIndex = flow.indexOf('const completedForConsent = await loadLatestCompletedBookingSession');
  const activeIndex = flow.indexOf('let session = await loadActiveBookingSession');
  assert.ok(consentIndex >= 0 && activeIndex > consentIndex);
  assert.match(flow, /resolveReminderConsentResponse[\s\S]*choice,[\s\S]*runId: context\.runId/i);
  assert.match(flow, /shouldPromptReminderConsent[\s\S]*reminderConsentPrompt/i);
  assert.match(flow, /choice === 'defer' && isLikelyNewBookingRequest\(input\.text\)/i);
});

test('confirmation and consent use separate, closed idempotency purposes', async () => {
  const flow = await readFile(new URL('../supabase/functions/beauty-ai-orchestrator/bookingFlow.ts', import.meta.url), 'utf8');
  const policy = await readFile(new URL('../supabase/functions/beauty-ai-orchestrator/policy.ts', import.meta.url), 'utf8');
  const sql = await multiMessageMigration();
  assert.match(flow, /sendReply\(reply, 'confirmation'\)/i);
  assert.match(flow, /sendReply\(reminderConsentPrompt, 'reminder-consent'\)/i);
  assert.match(flow, /recordReminderConsentPrompt[\s\S]*promptMessageId: prompt\.messageId/i);
  assert.match(policy, /aiMessagePurposes = \['default', 'confirmation', 'reminder-consent'\]/i);
  assert.match(policy, /client_request_id: `ai-run-\$\{runId\}\$\{suffix\}`/i);
  assert.match(sql, /(?:confirmation\|reminder-consent)/i);
  assert.match(sql, /AI_RESPONSE_REQUEST_ID_INVALID/i);
  assert.match(sql, /AI_RESPONSE_SUPERSEDED/i);
});

test('dispatcher claims atomically, revalidates server-side, and has no public access', async () => {
  const sql = await dispatchMigration();
  assert.match(sql, /claim_beauty_appointment_reminders/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /r\.status = 'processing' and r\.locked_at < now\(\) - make_interval/i);
  assert.match(sql, /status = 'processing'/i);
  assert.match(sql, /attempt_count = r\.attempt_count \+ 1/i);
  assert.match(sql, /lock_token = gen_random_uuid\(\)/i);
  assert.match(sql, /prepare_beauty_appointment_reminder_dispatch/i);
  assert.match(sql, /v_appointment\.status <> 'confirmed'/i);
  assert.match(sql, /v_customer\.reminder_consent_status <> 'granted'/i);
  assert.match(sql, /APPOINTMENT_CANCELLED/i);
  assert.match(sql, /INVALID_PHONE/i);
  assert.match(sql, /WHATSAPP_DISCONNECTED/i);
  assert.match(sql, /APPOINTMENT_SERVICE_INVALID/i);
  assert.match(sql, /settle_beauty_appointment_reminder_dispatch/i);
  assert.match(sql, /r\.lock_token = p_lock_token/i);
  assert.match(sql, /r\.schedule_revision = p_schedule_revision/i);
  assert.match(sql, /revoke all on function public\.claim_beauty_appointment_reminders[\s\S]*from public, anon, authenticated/i);
});

test('dispatcher remains observation-only by default and reserves revision-specific messages', async () => {
  const dispatcher = await readFile(new URL('../supabase/functions/beauty-appointment-reminders-dispatch/index.ts', import.meta.url), 'utf8');
  const helper = await readFile(new URL('../supabase/functions/beauty-appointment-reminders-dispatch/reminderDispatcher.ts', import.meta.url), 'utf8');
  assert.match(helper, /value\?\.trim\(\)\.toLowerCase\(\) !== 'false'/i);
  assert.match(helper, /reminder:\$\{appointmentId\}:day_before:r\$\{scheduleRevision\}/i);
  assert.match(dispatcher, /x-reminder-cron-secret/i);
  assert.match(dispatcher, /REMINDERS_CRON_SECRET/i);
  assert.match(dispatcher, /if \(dryRun\)[\s\S]*status: 'pending'[\s\S]*dryRun: true/i);
  assert.match(dispatcher, /DELIVERY_UNKNOWN/i);
  assert.match(dispatcher, /\['sent', 'delivered', 'read'\]/i);
  assert.match(dispatcher, /status: 'failed', errorCode: 'DELIVERY_UNKNOWN'/i);
});
