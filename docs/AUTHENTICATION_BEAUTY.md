# Autenticación del frontend Beauty

La fase 3B.1 conecta únicamente Supabase Auth y la identidad básica del negocio.
Las citas, profesionales, servicios, clientes, mensajes y automatizaciones siguen
usando los repositorios mock. `VITE_BEAUTY_DATA_MODE=mock` no debe cambiar en
esta fase.

## Flujo

1. Supabase restaura la sesión mediante su cliente oficial.
2. Sin sesión se muestra el login de COSTABOTS Beauty.
3. Con sesión se consultan las membresías activas del usuario bajo RLS.
4. Se cargan únicamente los negocios visibles bajo RLS.
5. Una membresía entra directamente; varias muestran un selector explícito.
6. Sin membresía activa no se monta el Manager.
7. El cierre de sesión limpia la sesión mediante `supabase.auth.signOut()`.

La aplicación no copia ni almacena tokens manualmente y no utiliza
`service_role`. El `business_id` no se toma de parámetros de la interfaz: se
deriva siempre de la membresía autenticada.

## URLs de Supabase Auth pendientes de configuración manual

En **Supabase → Authentication → URL Configuration** se deben revisar y añadir:

- Desarrollo: `http://127.0.0.1:5194`
- Desarrollo alternativo: `http://localhost:5194`
- Recuperación local: `http://127.0.0.1:5194/auth/reset-password`
- Recuperación local alternativa: `http://localhost:5194/auth/reset-password`
- Producción: la URL vigente de COSTABOTS Beauty en Vercel.
- Recuperación de producción: `<URL_VERCEL>/auth/reset-password`

No se ha modificado Vercel ni se ha supuesto aquí una URL de producción.
La ruta estable de recuperación es `/auth/reset-password`; el hosting deberá
servir `index.html` para esa ruta SPA.

## Límites de esta fase

- No hay conexión operativa de agenda, clientes, profesionales o servicios.
- No hay Realtime, WhatsApp, Gemini ni Evolution API.
- No se han modificado RLS, migraciones ni funciones remotas.
- El selector multinegocio es deliberadamente sencillo para el MVP.
