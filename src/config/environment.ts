const EXPECTED_PRODUCT_ID = 'costabots-beauty';
const BLOCKED_HOSPITALITY_PROJECT_FINGERPRINT = 0x96b669ed;
const VALID_EXECUTION_ENVIRONMENTS = new Set(['local', 'development', 'test', 'staging', 'production']);
const VALID_DATA_MODES = new Set(['mock', 'supabase']);

function required(name: string, value: unknown) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`[COSTABOTS Beauty] Falta la variable obligatoria ${name}. La aplicación se ha bloqueado de forma segura.`);
  }
  return normalized;
}

function toBoolean(value: unknown) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function projectFingerprint(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readSupabaseProjectRef(url: URL) {
  const match = url.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
  return match?.[1]?.toLowerCase() ?? '';
}

function validateEnvironment() {
  const productId = required('VITE_PRODUCT_ID', import.meta.env.VITE_PRODUCT_ID);
  if (productId !== EXPECTED_PRODUCT_ID) {
    throw new Error(`[COSTABOTS Beauty] VITE_PRODUCT_ID debe ser "${EXPECTED_PRODUCT_ID}". Se rechazó una configuración heredada.`);
  }

  const executionEnvironment = required('VITE_APP_ENV', import.meta.env.VITE_APP_ENV).toLowerCase();
  if (!VALID_EXECUTION_ENVIRONMENTS.has(executionEnvironment)) {
    throw new Error('[COSTABOTS Beauty] VITE_APP_ENV no es válido. Usa local, development, test, staging o production.');
  }

  const supabaseUrlValue = required('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL);
  const supabasePublishableKey = required('VITE_SUPABASE_PUBLISHABLE_KEY', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
  const expectedProjectRef = required('VITE_EXPECTED_SUPABASE_PROJECT_REF', import.meta.env.VITE_EXPECTED_SUPABASE_PROJECT_REF).toLowerCase();
  const dataMode = required('VITE_BEAUTY_DATA_MODE', import.meta.env.VITE_BEAUTY_DATA_MODE).toLowerCase();
  if (!VALID_DATA_MODES.has(dataMode)) {
    throw new Error('[COSTABOTS Beauty] VITE_BEAUTY_DATA_MODE debe ser "mock" o "supabase".');
  }

  let supabaseUrl: URL;
  try {
    supabaseUrl = new URL(supabaseUrlValue);
  } catch {
    throw new Error('[COSTABOTS Beauty] VITE_SUPABASE_URL no es una URL válida.');
  }

  if (supabaseUrl.protocol !== 'https:' && executionEnvironment !== 'local' && executionEnvironment !== 'test') {
    throw new Error('[COSTABOTS Beauty] Supabase debe usar HTTPS fuera de local/test.');
  }

  const actualProjectRef = readSupabaseProjectRef(supabaseUrl);
  if (!actualProjectRef || actualProjectRef !== expectedProjectRef) {
    throw new Error('[COSTABOTS Beauty] La URL de Supabase no coincide con VITE_EXPECTED_SUPABASE_PROJECT_REF. Se rechazó una configuración heredada.');
  }

  if (projectFingerprint(actualProjectRef) === BLOCKED_HOSPITALITY_PROJECT_FINGERPRINT) {
    throw new Error('[COSTABOTS Beauty] BLOQUEO DE SEGURIDAD: COSTABOTS Beauty no puede utilizar credenciales del Supabase original de COSTABOTS Hospitality.');
  }

  return Object.freeze({
    productId,
    executionEnvironment,
    dataMode: dataMode as 'mock' | 'supabase',
    publicSignupEnabled: dataMode === 'supabase'
      && toBoolean(import.meta.env.VITE_BEAUTY_PUBLIC_SIGNUP_ENABLED),
    whatsappEnabled: dataMode === 'supabase'
      && toBoolean(import.meta.env.VITE_BEAUTY_WHATSAPP_ENABLED),
    supabaseUrl: supabaseUrl.toString().replace(/\/$/, ''),
    supabasePublishableKey,
    supabaseProjectRef: actualProjectRef,
    publicApiBaseUrl: String(import.meta.env.VITE_BEAUTY_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/$/, ''),
    enableLegacySheets: toBoolean(import.meta.env.VITE_ENABLE_LEGACY_SHEETS),
    enableLegacyWebhooks: toBoolean(import.meta.env.VITE_ENABLE_LEGACY_WEBHOOKS),
    useManagerApi: toBoolean(import.meta.env.VITE_USE_MANAGER_API),
  });
}

export const beautyEnvironment = validateEnvironment();

export function requireBeautyPublicApi() {
  if (!beautyEnvironment.publicApiBaseUrl) {
    throw new Error('[COSTABOTS Beauty] La API pública de Beauty está deshabilitada hasta configurar VITE_BEAUTY_PUBLIC_API_BASE_URL.');
  }
  return beautyEnvironment.publicApiBaseUrl;
}

export function requireLegacySheets() {
  if (!beautyEnvironment.enableLegacySheets) {
    throw new Error('[COSTABOTS Beauty] La integración heredada con Google Sheets está deshabilitada.');
  }
}

export function requireLegacyWebhooks() {
  if (!beautyEnvironment.enableLegacyWebhooks) {
    throw new Error('[COSTABOTS Beauty] Los webhooks heredados están deshabilitados.');
  }
}
