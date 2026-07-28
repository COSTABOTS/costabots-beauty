import { supabase } from '../../../lib/supabaseClient';
import type { BeautyMembership } from '../types';

const safeAuthError = 'No hemos podido completar la solicitud. Revisa los datos e inténtalo de nuevo.';

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    throw new Error(error.message === 'Invalid login credentials'
      ? 'El correo o la contraseña no son correctos.'
      : safeAuthError);
  }
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error('No hemos podido cerrar la sesión. Inténtalo de nuevo.');
}

export async function requestPasswordReset(email: string) {
  const redirectTo = `${window.location.origin}/auth/reset-password`;
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw new Error(safeAuthError);
}

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error('No hemos podido actualizar la contraseña. Solicita un enlace nuevo.');
}

type MembershipRow = {
  id: string;
  business_id: string;
  role: BeautyMembership['role'];
};

type BusinessRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  default_currency: string;
  default_language: string;
};

export async function loadActiveMemberships(userId: string): Promise<BeautyMembership[]> {
  const membersResult = await supabase
    .from('business_members')
    .select('id,business_id,role')
    .eq('user_id', userId)
    .eq('active', true);

  if (membersResult.error) {
    throw new Error('No hemos podido comprobar tu acceso. Inténtalo de nuevo en unos minutos.');
  }

  const memberRows = (membersResult.data ?? []) as MembershipRow[];
  if (memberRows.length === 0) return [];

  const businessResult = await supabase
    .from('beauty_businesses')
    .select('id,name,slug,timezone,default_currency,default_language')
    .in('id', memberRows.map((membership) => membership.business_id))
    .eq('active', true);

  if (businessResult.error) {
    throw new Error('No hemos podido cargar tu negocio. Inténtalo de nuevo en unos minutos.');
  }

  const businesses = new Map(
    ((businessResult.data ?? []) as BusinessRow[]).map((row) => [row.id, row]),
  );

  return memberRows.flatMap((membership) => {
    const business = businesses.get(membership.business_id);
    if (!business) return [];
    return [{
      id: membership.id,
      role: membership.role,
      business: {
        id: business.id,
        name: business.name,
        slug: business.slug,
        timezone: business.timezone,
        defaultCurrency: business.default_currency,
        defaultLanguage: business.default_language,
      },
    }];
  });
}
