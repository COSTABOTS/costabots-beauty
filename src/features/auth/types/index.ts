import type { Session, User } from '@supabase/supabase-js';

export type AuthState =
  | { status: 'loading'; session: null; user: null; message: null }
  | { status: 'unauthenticated'; session: null; user: null; message: null }
  | { status: 'authenticated'; session: Session; user: User; message: null }
  | { status: 'error'; session: null; user: null; message: string };

export type BeautyBusiness = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  defaultCurrency: string;
  defaultLanguage: string;
};

export type BeautyMembership = {
  id: string;
  role: 'owner' | 'admin' | 'staff';
  business: BeautyBusiness;
};
