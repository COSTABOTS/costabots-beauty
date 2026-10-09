import { supabase } from '../../lib/supabaseClient';
import type { BillingAccess } from './types';

function mapAccess(row: Record<string, unknown>): BillingAccess {
  return {
    subjectEnrolled: Boolean(row.subject_enrolled),
    allowed: Boolean(row.allowed),
    state: String(row.state) as BillingAccess['state'],
    plan: row.plan === 'founder' || row.plan === 'standard' ? row.plan : null,
    subscriptionStatus: (row.subscription_status ? String(row.subscription_status) : null) as BillingAccess['subscriptionStatus'],
    graceEndsAt: row.grace_ends_at ? String(row.grace_ends_at) : null,
    canManageBilling: Boolean(row.can_manage_billing),
  };
}

export async function loadBillingAccess(businessId: string) {
  const { data, error } = await supabase.rpc('get_beauty_billing_access', { p_business_id: businessId });
  if (error) throw new Error('No hemos podido comprobar el estado del pago.');
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('No hemos podido comprobar el estado del pago.');
  return mapAccess(row as Record<string, unknown>);
}

async function invokeUrl(name: string, businessId: string) {
  const { data, error } = await supabase.functions.invoke(name, { body: { businessId } });
  if (error) {
    throw new Error('No hemos podido abrir la página de pago. Inténtalo de nuevo.');
  }
  const url = String((data as { url?: unknown } | null)?.url ?? '');
  if (!url.startsWith('https://')) throw new Error('No hemos recibido una URL de pago válida.');
  return url;
}

export const createCheckout = (businessId: string) => invokeUrl('beauty-billing-checkout', businessId);
export const openCustomerPortal = (businessId: string) => invokeUrl('beauty-billing-portal', businessId);
