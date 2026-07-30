# Base de WhatsApp con Evolution API

> Estado: base técnica preparada. No hay ningún número conectado desde
> COSTABOTS Beauty, las Edge Functions no están desplegadas y la feature flag
> permanece desactivada.

## Arquitectura

```text
Manager Beauty autenticado
  -> Supabase Edge Functions privadas
  -> Evolution API 2.3.x

Evolution API
  -> evolution-beauty-webhook (público, secreto validado)
  -> tablas Beauty con acceso servidor

Manager Beauty
  -> RLS/RPC de Supabase
  -> conversaciones y mensajes de su negocio
```

El navegador nunca recibe `EVOLUTION_API_KEY`, tokens de instancia ni el
secreto del webhook. No llama directamente a Evolution.

## Separación por negocio e instancias

`beauty_whatsapp_connections.business_id` es único. `instance_name` también es
único y se genera en servidor con el patrón
`beauty_<8 caracteres del UUID>_<10 caracteres aleatorios>`. El usuario no
puede elegir ni necesita ver este identificador.

La instancia manual `beauty-demo` queda fuera del flujo y no se vincula
automáticamente. La instancia Hospitality `Safar` queda fuera del alcance.

## Secretos

Las Edge Functions necesitan:

- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_WEBHOOK_SECRET`

Se configurarán posteriormente, sin incluir valores en el repositorio:

```powershell
npx supabase secrets set EVOLUTION_API_URL
npx supabase secrets set EVOLUTION_API_KEY
npx supabase secrets set EVOLUTION_WEBHOOK_SECRET
```

No deben existir variantes `VITE_*`. Supabase proporciona `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY` al runtime servidor; esta última se usa únicamente
dentro de las funciones y nunca en el frontend.

## Tablas

- `beauty_whatsapp_connections`: estado seguro de una conexión por negocio.
- `beauty_conversations`: bandeja, modo `ai/manual`, asignación y no leídos.
- `beauty_messages`: mensajes idempotentes por conversación/provider ID.
- `beauty_whatsapp_webhook_events`: auditoría reducida e idempotencia.

No se guarda la API key, un token de instancia ni el QR. `payload_summary`
solo contiene metadatos reducidos. Debe añadirse una tarea de retención para
eliminar eventos técnicos antiguos; se recomiendan 30 días salvo obligación
legal distinta.

## RLS y permisos

Todas las tablas tienen `business_id`, RLS habilitada y forzada.

- Miembros activos pueden leer conexión, conversaciones y mensajes.
- No existen políticas de escritura directa para el frontend.
- Owner/admin aprovisionan, generan QR y desconectan mediante Edge Functions.
- Owner/admin/staff pueden tomar conversaciones y responder manualmente.
- Los eventos técnicos no tienen política de lectura para usuarios.
- `anon` no puede leer tablas ni ejecutar RPC internas.

Las escrituras del webhook solo ocurren después de validar el secreto y
resolver el negocio desde `instance_name`; nunca se confía en un `business_id`
del payload.

## RPC

- `take_beauty_conversation`: bloquea la fila, pasa a manual y asigna
  `auth.uid()`. Impide que otra persona la tome simultáneamente.
- `release_beauty_conversation`: prepara el modo `ai`, sin enviar nada.
- `mark_beauty_conversation_read`: pone el contador a cero para miembros.
- `increment_beauty_conversation_unread`: exclusiva del rol servidor.

“Devolver a la IA” muestra una confirmación honesta: Gemini todavía no está
activo y la acción solo prepara el estado futuro.

## Edge Functions

- `beauty-whatsapp-provision`: idempotente por negocio, genera el nombre,
  crea la instancia y configura el webhook.
- `beauty-whatsapp-status`: consulta Evolution y actualiza estado seguro.
- `beauty-whatsapp-qr`: obtiene un QR temporal para una instancia existente.
- `beauty-whatsapp-send-message`: texto manual de hasta 2.000 caracteres,
  conversación en modo manual y request ID idempotente.
- `beauty-whatsapp-disconnect`: logout sin eliminar historial o instancia.
- `evolution-beauty-webhook`: endpoint público con secreto, límite de tamaño,
  rate limit por proceso, idempotencia y resolución por instancia.

Los eventos configurados para Evolution v2 son `QRCODE_UPDATED`,
`CONNECTION_UPDATE`, `MESSAGES_UPSERT`, `MESSAGES_UPDATE` y `SEND_MESSAGE`.
El parser también normaliza la notación con puntos a guiones bajos. Antes del
despliegue se deben confirmar nombres y payloads contra la instalación exacta
2.3.7 de Railway mediante su documentación/API de solo lectura.

## Aprovisionamiento y QR

El aprovisionamiento crea primero una fila `provisioning` protegida por la
restricción única. Los reintentos devuelven la conexión existente; un doble
clic no genera otra instancia. Si Evolution falla, conserva un error
sanitizado y nunca devuelve su respuesta cruda.

El QR exige confirmación de autorización, no se escribe en base de datos ni en
logs y se muestra solo en memoria. La interfaz recomienda un número comercial
dedicado e incluye WhatsApp → Dispositivos vinculados → Vincular dispositivo.

## Webhook e idempotencia

El webhook acepta solo POST, limita el cuerpo a 256 KiB, compara el secreto,
rechaza instancias desconocidas y registra un hash idempotente. Ignora grupos,
status, newsletters y broadcasts; descarta mensajes anteriores a
`activated_at`; busca al cliente por teléfono sin crearlo; y responde sin
devolver datos del negocio.

Los mensajes enviados desde el teléfono se guardan como `outbound/human`,
cambian el modo a manual y muestran “Atención manual detectada”. Un mensaje
entrante nunca cambia una conversación manual de vuelta a `ai`.

## Manager

Con la flag activa en modo Supabase:

- Configuración muestra estado, aprovisionamiento, QR, refresco y desconexión.
- Mensajes muestra “Todas” y “Necesitan atención”.
- El historial se carga en páginas de 50.
- El compositor solo funciona con conexión `connected` y modo `manual`.
- Con WhatsApp desconectado el historial permanece visible.

En mock se conserva la bandeja ficticia y no se invoca Evolution. En Supabase
no existe fallback a mock.

## Privacidad y limitaciones

- No se importa el historial antiguo ni se crean clientes automáticamente.
- Multimedia entrante se identifica con texto seguro; no se descarga.
- No hay Gemini, reservas conversacionales, transcripción, campañas,
  plantillas Meta, adjuntos salientes, Chatwoot ni Realtime.

## Despliegue posterior

1. Confirmar que el project ref enlazado es Beauty.
2. Aplicar la migración 25.
3. Configurar los tres secretos.
4. Validar endpoints/eventos de Evolution 2.3.7 sin modificar `Safar`.
5. Desplegar únicamente las seis funciones Beauty.
6. Probar el webhook con payloads controlados.
7. Activar solo localmente `VITE_BEAUTY_WHATSAPP_ENABLED=true`.
8. Realizar la prueba con línea dedicada.
9. Solo después valorar activar la flag en Vercel.

Rollback: desactivar la flag, retirar el webhook de la instancia Beauty y
desplegar nuevamente las funciones anteriores. No borrar mensajes ni ejecutar
`instance/delete`.

## Pruebas pendientes con línea dedicada

- Despliegue controlado de las seis Edge Functions Beauty.
- Configuración de `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` y
  `EVOLUTION_WEBHOOK_SECRET` mediante Supabase secrets.
- Confirmación del payload real de Evolution API 2.3.7.
- Escaneo y expiración de QR.
- Conexión, reconexión y desconexión real.
- Mensaje entrante y saliente real.
- Estados delivered/read.
- Respuesta manual desde el móvil y cambio automático a manual.
- Webhook real desde Evolution.
- Aislamiento entre dos instancias conectadas.
- Segundo usuario autenticado de otro negocio intentando consultar, tomar y
  enviar en una conversación ajena; membership y RLS deben rechazarlo.
- `deno check` completo de todas las Edge Functions. En esta revisión solo se
  pudo comprobar su sintaxis porque Deno no está instalado en el entorno.

## Comprobar que Hospitality sigue intacto

Antes y después del futuro despliegue, realizar solo consultas de estado:

1. listar instancias en Evolution;
2. comprobar que `Safar` continúa `connected`;
3. comprobar que su webhook/configuración no cambió;
4. comprobar que `beauty-demo` continúa sin vincular y sin QR escaneado;
5. verificar que únicamente funciones con prefijo Beauty fueron desplegadas.
