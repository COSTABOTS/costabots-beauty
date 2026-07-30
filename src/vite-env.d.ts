/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRODUCT_ID: string;
  readonly VITE_APP_ENV: 'local' | 'development' | 'test' | 'staging' | 'production';
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_EXPECTED_SUPABASE_PROJECT_REF: string;
  readonly VITE_BEAUTY_DATA_MODE: 'mock' | 'supabase';
  readonly VITE_BEAUTY_PUBLIC_SIGNUP_ENABLED?: string;
  readonly VITE_BEAUTY_PUBLIC_API_BASE_URL?: string;
  readonly VITE_ENABLE_LEGACY_SHEETS?: string;
  readonly VITE_ENABLE_LEGACY_WEBHOOKS?: string;
  readonly VITE_LEGACY_ADD_WALKIN_WEBHOOK?: string;
  readonly VITE_LEGACY_UPDATE_RESERVATION_WEBHOOK?: string;
  readonly VITE_USE_MANAGER_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
