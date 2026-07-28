# Aislamiento técnico

## Conexiones neutralizadas

- Los endpoints absolutos del Supabase Hospitality fueron retirados de `src/services/publicFeedback.ts`.
- El fallback de Safari, incluido su identificador y token público, fue retirado.
- El login Make incrustado en `src/App.tsx` fue sustituido por un fallo local seguro.
- Los enlaces Vercel heredados se sustituyeron por rutas internas bajo `/legacy-disabled/`.
- CORS solo permite localhost por defecto. Orígenes futuros requieren `BEAUTY_ALLOWED_ORIGINS`.
- Google Sheets requiere `ENABLE_LEGACY_SHEETS=true` en Edge Functions y `VITE_ENABLE_LEGACY_SHEETS=true` en frontend. Ambos valores están desactivados por defecto.

## Edge Functions heredadas

| Función | Estado actual | Clasificación recomendada | Recomendación Beauty |
|---|---|---|---|
| `manager-api` | `verify_jwt = false` | Debe requerir JWT | Activar verificación JWT y autorización por `business_id` después de separar las acciones legacy. |
| `get-tables` | JWT no declarado en config | Debe requerir JWT | No desplegar; retirar al abandonar Google Sheets. |
| `get-tables-test` | `verify_jwt = false` | Pendiente de rediseño | No desplegar; eliminar cuando termine la caracterización legacy. |
| `public-api` | `verify_jwt = false` | Pública con secret/firma y rutas de webhook externo | Dividir endpoints públicos, cron y webhooks; añadir firmas, tokens de un solo uso, rate limits e idempotencia. |

Ninguna función se ha ejecutado o desplegado durante el aislamiento.

## Variables frontend

- `VITE_PRODUCT_ID`
- `VITE_APP_ENV`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_BEAUTY_SUPABASE_PROJECT_REF`
- `VITE_BEAUTY_PUBLIC_API_BASE_URL`
- `VITE_ENABLE_LEGACY_SHEETS`
- `VITE_ENABLE_LEGACY_WEBHOOKS`
- `VITE_USE_MANAGER_API`
- `VITE_USE_EDGE_TABLES`

## Variables de Edge Functions

- `BEAUTY_ALLOWED_ORIGINS`
- `ENABLE_LEGACY_SHEETS`
- `LEGACY_DEMO_SHEET_ID` (solo caracterización local; no usar datos reales)

## Guardia de Supabase

`src/config/environment.ts` exige identidad de producto, entorno, URL, anon key y project ref Beauty. Comprueba que el ref de la URL coincida con el esperado y rechaza mediante una huella no reversible el proyecto Hospitality conocido. No se conserva su ref ni URL en texto plano.
