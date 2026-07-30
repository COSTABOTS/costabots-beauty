import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { internalBusinessId, safeHandoffReason } from './policy.ts';
import type { AiConversationContext, ToolCall, ToolExecutionResult } from './types.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const dayNames: Record<number, string> = {
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábado',
  7: 'domingo',
};

function validUuid(value: unknown) {
  const normalized = String(value ?? '');
  if (!UUID_PATTERN.test(normalized)) throw new Error('AI_TOOL_INVALID');
  return normalized;
}

function optionalUuid(value: unknown) {
  if (value === undefined || value === null || value === '') return null;
  return validUuid(value);
}

function validDate(value: unknown) {
  const normalized = String(value ?? '');
  if (!DATE_PATTERN.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new Error('AI_TOOL_INVALID');
  }
  return normalized;
}

function localDateTime(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(value));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')} ${read('hour')}:${read('minute')}`;
}

async function getBusinessInfo(client: SupabaseClient, businessId: string) {
  const business = await client.from('beauty_businesses')
    .select('name,address,phone,timezone,default_language')
    .eq('id', businessId).eq('active', true).single();
  if (business.error || !business.data) throw new Error('AI_TOOL_FAILED');

  const schedules = await client.from('staff_schedules')
    .select('day_of_week,start_time,end_time,staff_members!inner(display_name,active)')
    .eq('business_id', businessId).eq('active', true)
    .eq('staff_members.active', true)
    .order('day_of_week').order('start_time');
  if (schedules.error) throw new Error('AI_TOOL_FAILED');

  return {
    businessName: business.data.name,
    address: business.data.address,
    publicPhone: business.data.phone,
    timezone: business.data.timezone,
    language: business.data.default_language,
    weeklyHours: (schedules.data ?? []).map((row) => ({
      day: dayNames[Number(row.day_of_week)] ?? String(row.day_of_week),
      startsAt: String(row.start_time).slice(0, 5),
      endsAt: String(row.end_time).slice(0, 5),
      professional: (row.staff_members as unknown as { display_name: string }).display_name,
    })),
  };
}

async function listServices(client: SupabaseClient, businessId: string) {
  const services = await client.from('beauty_services')
    .select('id,name,description,duration_minutes,price,currency')
    .eq('business_id', businessId)
    .eq('active', true)
    .eq('online_booking_enabled', true)
    .order('name')
    .limit(50);
  if (services.error) throw new Error('AI_TOOL_FAILED');
  return {
    services: (services.data ?? []).map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.duration_minutes,
      price: service.price,
      currency: service.currency,
    })),
  };
}

async function getAvailability(
  client: SupabaseClient,
  businessId: string,
  args: Record<string, unknown>,
) {
  const serviceId = validUuid(args.service_id);
  const date = validDate(args.date);
  const staffId = optionalUuid(args.staff_id);

  const business = await client.from('beauty_businesses')
    .select('timezone').eq('id', businessId).eq('active', true).single();
  const service = await client.from('beauty_services')
    .select('id').eq('id', serviceId).eq('business_id', businessId)
    .eq('active', true).eq('online_booking_enabled', true).maybeSingle();
  if (business.error || !business.data || service.error || !service.data) {
    return { available: false, reason: 'SERVICE_NOT_AVAILABLE', slots: [] };
  }
  if (staffId) {
    const staff = await client.from('staff_members').select('id')
      .eq('id', staffId).eq('business_id', businessId).eq('active', true).maybeSingle();
    if (staff.error || !staff.data) return { available: false, reason: 'PROFESSIONAL_NOT_AVAILABLE', slots: [] };
  }

  const result = await client.rpc('get_beauty_ai_availability', {
    p_business_id: businessId,
    p_service_id: serviceId,
    p_date: date,
    p_staff_member_id: staffId,
    p_slot_interval_minutes: 15,
  });
  if (result.error) throw new Error('AI_TOOL_FAILED');

  const rows = (result.data ?? []) as Array<{
    staff_member_id: string;
    staff_display_name: string;
    starts_at: string;
    ends_at: string;
    available: boolean;
  }>;
  const slots = rows.filter((row) => row.available).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, 5)
    .map((row) => ({
      startsAt: localDateTime(row.starts_at, business.data.timezone),
      endsAt: localDateTime(row.ends_at, business.data.timezone),
      timezone: business.data.timezone,
      staffId: row.staff_member_id,
      professional: row.staff_display_name,
    }));
  return { available: slots.length > 0, slots };
}

async function requestHumanHandoff(
  client: SupabaseClient,
  context: AiConversationContext,
  args: Record<string, unknown>,
) {
  const reason = safeHandoffReason(args.reason);
  const result = await client.from('beauty_conversations').update({
    mode: 'manual',
    assigned_user_id: null,
    needs_attention: true,
    attention_reason: `AI_HANDOFF_${reason.toUpperCase()}`,
  }).eq('id', context.conversationId).eq('business_id', context.businessId)
    .eq('mode', 'ai').select('id').maybeSingle();
  if (result.error) throw new Error('AI_TOOL_FAILED');
  return {
    value: { handedOff: Boolean(result.data), reason },
    handoffRequested: Boolean(result.data),
  };
}

export async function executeTool(
  client: SupabaseClient,
  context: AiConversationContext,
  call: ToolCall,
): Promise<ToolExecutionResult> {
  const businessId = internalBusinessId(context.businessId, call.args);
  if (call.name === 'get_business_info') return { value: await getBusinessInfo(client, businessId) };
  if (call.name === 'list_services') return { value: await listServices(client, businessId) };
  if (call.name === 'get_availability') return { value: await getAvailability(client, businessId, call.args) };
  if (call.name === 'request_human_handoff') return requestHumanHandoff(client, context, call.args);
  throw new Error('AI_TOOL_INVALID');
}
