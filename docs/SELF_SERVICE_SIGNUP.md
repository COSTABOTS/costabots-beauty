# Alta autoservicio de COSTABOTS Beauty

## Estado y alcance

El alta autoservicio está implementada detrás de
`VITE_BEAUTY_PUBLIC_SIGNUP_ENABLED`. Su valor seguro por defecto es `false`.
Además, el frontend solo considera la función activa cuando
`VITE_BEAUTY_DATA_MODE=supabase`; el modo mock nunca crea usuarios ni llama al
aprovisionamiento.

Antes de abrir el registro públicamente siguen pendientes CAPTCHA, textos
legales definitivos, controles adicionales contra abuso y una política de
limpieza de cuentas no confirmadas. Stripe, suscripciones, WhatsApp, Evolution
API, Gemini, Realtime, invitaciones y activación del bot están fuera de esta
fase.

## Flujo

1. La persona abre **Crear cuenta** desde la pantalla de acceso.
2. Introduce nombre, negocio, tipo, email, teléfono y contraseña, y acepta los
   términos y privacidad mostrados.
3. `supabase.auth.signUp` crea la identidad y guarda únicamente metadata inicial
   no sensible:
   `beauty_signup_source`, `owner_display_name`, `business_name`,
   `business_type` y `business_phone`.
4. La contraseña solo se entrega a Supabase Auth y no se guarda en metadata,
   localStorage, tablas de Beauty ni logs.
5. La aplicación muestra **Revisa tu correo**. El reenvío tiene una espera
   visible de 60 segundos.
6. El acceso operativo permanece bloqueado hasta que Auth expone
   `email_confirmed_at`.
7. Tras confirmar e iniciar sesión, `MembershipGate` busca una membresía activa.
8. Si ya existe, entra normalmente. Si no existe y la metadata identifica un
   alta autoservicio válida, muestra **Estamos preparando tu espacio** y llama a
   `complete_beauty_signup`.
9. La RPC crea el negocio, la membresía owner y el primer profesional en una
   transacción y devuelve identificadores no sensibles.
10. El Manager vuelve a cargar la membresía y abre el onboarding existente.

## Aprovisionamiento e idempotencia

La migración `20260730140023_self_service_signup.sql` añade:

- `beauty_businesses.business_type`, limitado a `nail_salon`, `hair_salon`,
  `beauty_center` u `other`;
- la RPC autenticada `complete_beauty_signup`.

La RPC no acepta `user_id`, `owner_id`, `role`, `business_id`, estado de
suscripción, Stripe, WhatsApp ni campos técnicos. Obtiene la identidad con
`auth.uid()` y comprueba `auth.users.email_confirmed_at`.

Un advisory lock transaccional derivado del usuario serializa doble clic,
recargas, reintentos y dos llamadas simultáneas. Dentro del mismo bloqueo se
vuelve a buscar una membresía activa. Si existe, se devuelve sin insertar nada.
Si no existe, negocio, owner y profesional se crean atómicamente; cualquier
error revierte la operación completa.

El slug se normaliza en servidor y recibe un sufijo derivado de un UUID nuevo.
El nombre visible nunca se usa directamente como identificador técnico.

## Tablas y RLS

Intervienen:

- `auth.users`, únicamente para identidad y confirmación;
- `beauty_businesses`;
- `business_members`;
- `staff_members`.

No se abren políticas. Las tablas continúan con RLS habilitado y forzado. La
función usa `SECURITY DEFINER` y `search_path` fijo, revoca `public` y `anon`, y
concede `EXECUTE` solo a `authenticated`. Al terminar, las políticas existentes
permiten al owner leer únicamente el negocio asociado a su membresía.

La metadata solo aporta datos iniciales. Nunca determina permisos, usuario,
rol ni tenant; esos valores se fijan dentro de la RPC.

## Feature flag

```env
VITE_BEAUTY_PUBLIC_SIGNUP_ENABLED=false
```

- `false`: no aparece **Crear cuenta**.
- `true` y modo `supabase`: aparece el registro real.
- modo `mock`: permanece oculto aunque alguien intente activar la flag.

Vercel debe conservar la flag desactivada hasta aprobar la apertura pública.

## Errores y recuperación

El frontend traduce correo existente, correo no confirmado, contraseña
insuficiente, rate limit y red a mensajes comprensibles. No muestra SQL,
tablas, stack traces ni códigos internos.

Si el aprovisionamiento falla, se ofrece **Volver a intentar**. La misma RPC
puede repetirse de forma segura. Una sesión expirada vuelve al flujo normal de
Auth.

## Pruebas obligatorias pendientes antes de activar el registro público

1. Registro con un correo controlado.
2. Recepción real del email de confirmación.
3. Confirmación real del correo.
4. Primer inicio de sesión tras confirmar el correo.
5. Creación automática del negocio.
6. Creación de una sola membresía con rol `owner`.
7. Creación de un solo profesional inicial.
8. Recarga del navegador durante el aprovisionamiento.
9. Reintento idempotente de `complete_beauty_signup`.
10. Dos llamadas autenticadas simultáneas para el mismo usuario.
11. Reenvío del email y validación del rate limit real.
12. Aislamiento RLS: el usuario A no puede acceder al negocio del usuario B.
13. CAPTCHA antes de abrir el registro al público.
14. Textos legales definitivos y registro de aceptación conforme al modelo legal elegido.
15. Procedimiento de limpieza para registros abandonados.

No deben utilizarse `service_role`, secret keys ni contraseñas administrativas
en el frontend o en scripts versionados.

## Requisitos pendientes para apertura pública

- integrar CAPTCHA compatible con Supabase Auth;
- definir versiones y enlaces definitivos de términos y privacidad, y decidir
  el registro legal auditable de la aceptación;
- revisar rate limiting y protección contra registros masivos;
- diseñar limpieza de cuentas no confirmadas o abandonadas;
- impedir aprovisionar recursos externos o costosos antes del pago;
- añadir observabilidad segura sin datos personales ni secretos;
- completar pruebas de concurrencia con dos sesiones autenticadas reales.
