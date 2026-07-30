import { supabase } from '../../../lib/supabaseClient';
import type { User } from '@supabase/supabase-js';
import type { BeautyMembership } from '../types';

const safeAuthError = 'No hemos podido completar la solicitud. Revisa los datos e inténtalo de nuevo.';

function translateAuthError(message: string) {
  if (/invalid login credentials/i.test(message)) return 'El correo o la contraseña no son correctos.';
  if (/email not confirmed/i.test(message)) return 'Confirma tu correo antes de iniciar sesión.';
  if (/already registered|already been registered|user already exists/i.test(message)) return 'Ya existe una cuenta con este correo.';
  if (/password/i.test(message) && /weak|short|characters|least/i.test(message)) return 'La contraseña no cumple los requisitos de seguridad.';
  if (/rate limit|too many requests|over_email_send_rate_limit/i.test(message)) return 'Has realizado demasiados intentos. Espera unos minutos.';
  if (/network|fetch/i.test(message)) return 'No podemos conectar con el servicio de acceso. Revisa tu conexión.';
  return safeAuthError;
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw new Error(translateAuthError(error.message));
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

export type BeautyBusinessType = 'nail_salon' | 'hair_salon' | 'beauty_center' | 'other';

export type BeautySignUpInput = {
  ownerDisplayName: string;
  businessName: string;
  businessType: BeautyBusinessType;
  email: string;
  businessPhone: string;
  password: string;
};

export async function signUpBeautyAccount(input: BeautySignUpInput) {
  const email = input.email.trim().toLowerCase();
  const emailRedirectTo = `${window.location.origin}/`;
  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      emailRedirectTo,
      data: {
        beauty_signup_source: 'self_service',
        owner_display_name: input.ownerDisplayName.trim(),
        business_name: input.businessName.trim(),
        business_type: input.businessType,
        business_phone: input.businessPhone.trim(),
      },
    },
  });
  if (error) throw new Error(translateAuthError(error.message));
  if (!data.user || data.user.identities?.length === 0) {
    throw new Error('Ya existe una cuenta con este correo.');
  }
  // Email confirmation is mandatory for this flow. Do not depend on Supabase
  // returning a session after signUp.
  if (data.session) await supabase.auth.signOut({ scope: 'local' });
  return { email };
}

export async function resendSignUpConfirmation(email: string) {
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: { emailRedirectTo: `${window.location.origin}/` },
  });
  if (error) throw new Error(translateAuthError(error.message));
}

type SignupMetadata = {
  beauty_signup_source?: unknown;
  owner_display_name?: unknown;
  business_name?: unknown;
  business_type?: unknown;
  business_phone?: unknown;
};

export function hasSelfServiceSignupMetadata(user: User) {
  return (user.user_metadata as SignupMetadata | null)?.beauty_signup_source === 'self_service';
}

export async function completeBeautySignup(user: User) {
  if (!user.email_confirmed_at) throw new Error('Confirma tu correo antes de preparar el negocio.');
  const metadata = (user.user_metadata ?? {}) as SignupMetadata;
  if (metadata.beauty_signup_source !== 'self_service') {
    throw new Error('Faltan los datos iniciales del registro. Vuelve a iniciar sesión o contacta con soporte.');
  }
  const businessName = String(metadata.business_name ?? '').trim();
  const ownerDisplayName = String(metadata.owner_display_name ?? '').trim();
  const businessType = String(metadata.business_type ?? '').trim();
  const businessPhone = String(metadata.business_phone ?? '').trim();
  if (!businessName || !ownerDisplayName || !businessType || !businessPhone) {
    throw new Error('Faltan datos para preparar tu espacio. Revisa el registro e inténtalo de nuevo.');
  }
  const { data, error } = await supabase.rpc('complete_beauty_signup', {
    p_business_name: businessName,
    p_owner_display_name: ownerDisplayName,
    p_business_type: businessType,
    p_business_phone: businessPhone,
    p_timezone: 'Europe/Madrid',
    p_currency: 'EUR',
  });
  if (error) {
    if (/email confirmation|required/i.test(error.message)) throw new Error('Confirma tu correo antes de preparar el negocio.');
    if (/invalid|must not exceed|required/i.test(error.message)) throw new Error('Los datos iniciales no son válidos. Revisa el registro.');
    if (/network|fetch/i.test(error.message)) throw new Error('No podemos conectar para preparar tu espacio. Inténtalo de nuevo.');
    throw new Error('No hemos podido preparar tu espacio. Puedes volver a intentarlo sin crear duplicados.');
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.business_id) throw new Error('No hemos podido confirmar la creación de tu espacio.');
  return result as { business_id: string; membership_id: string; staff_member_id: string | null; created: boolean };
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
