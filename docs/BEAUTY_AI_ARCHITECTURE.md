# COSTABOTS Beauty — IA controlada para WhatsApp

## Estado

Este documento describe una primera versión preparada para revisión. La migración
no está aplicada, la función `beauty-ai-orchestrator` no está desplegada y la IA
permanece desactivada. No debe configurarse `GEMINI_API_KEY` ni activarse
`BEAUTY_AI_ENABLED` hasta completar la revisión y las pruebas remotas.

## Flujo

1. Evolution entrega un evento firmado a `evolution-beauty-webhook`.
2. El webhook valida instancia, evento y antigüedad, y registra el evento reducido.
3. Un mensaje inbound se guarda una sola vez en `beauty_messages`.
4. Solo cuando `BEAUTY_AI_ENABLED=true`, la conversación sigue en `mode=ai` y no
   existe una persona asignada, se reserva un `beauty_ai_run`.
5. La restricción única `(inbound_message_id, operation_type)` impide que un
   inbound genere dos ejecuciones.
6. El webhook responde a Evolution sin esperar a Gemini. `EdgeRuntime.waitUntil`
   invoca después la función privada `beauty-ai-orchestrator`.
7. El orquestador reclama atómicamente la ejecución pendiente y vuelve a validar
   negocio, conversación, mensaje inbound, modo y asignación.
8. Se limita el contexto a los 12 mensajes recientes. No se envían payloads de
   Evolution, tablas completas, teléfonos, secretos ni metadatos técnicos.
9. Gemini puede solicitar únicamente las herramientas controladas de esta fase.
10. Antes de reservar y antes de enviar la respuesta se comprueba otra vez que la
    conversación continúa en `mode=ai` y sin usuario asignado.
11. La respuesta queda reservada con `client_request_id=ai-run-<run-id>`. Después
    se envía mediante Evolution y se guarda como `sender_type=ai`.
12. Los ecos outbound de esa respuesta se reconocen por `provider_message_id` y
    no vuelven a insertar el mensaje, cambiar el modo ni activar otra ejecución.

## Herramientas disponibles

### `get_business_info`

Devuelve exclusivamente nombre comercial, dirección, teléfono público, zona
horaria, idioma y tramos semanales activos con el nombre visible del profesional.

### `list_services`

Devuelve como máximo 50 servicios activos y habilitados para reserva online:
identificador interno, nombre, descripción pública, duración, precio y moneda.

### `get_availability`

Acepta `service_id`, fecha local y `staff_id` opcional. El `business_id` nunca
procede del modelo: siempre se toma del `beauty_ai_run`.

La función server-only `get_beauty_ai_availability` reutiliza
`get_multi_service_availability`, por lo que mantiene horarios partidos, buffers,
citas activas, bloqueos globales e individuales y asignaciones profesional–servicio.
El orquestador devuelve como máximo cinco huecos y los convierte a la zona horaria
del negocio. Una validación adicional impide que la respuesta mencione horas no
presentes en los resultados de la herramienta.

### `request_human_handoff`

Acepta únicamente una razón de una lista cerrada. Cambia la conversación a
`mode=manual`, deja `assigned_user_id=null`, activa `needs_attention` y guarda una
razón técnica sanitizada. No crea citas ni envía un mensaje por sí misma.

## Límites funcionales

La IA puede:

- saludar y entender la intención;
- informar sobre negocio y horarios;
- listar servicios, precios y duraciones reales;
- recopilar servicio, fecha, franja y profesional opcional;
- consultar y ofrecer disponibilidad real;
- solicitar atención humana.

La IA no puede:

- crear, modificar o cancelar citas;
- crear o modificar clientes;
- cobrar;
- enviar promociones;
- actuar en conversaciones manuales;
- confirmar que una cita está reservada.

No hay herramientas de escritura de agenda en esta fase.

## Modelo y API de Gemini

`GEMINI_MODEL` es obligatorio y no tiene valor fijo en el código. Al activarse, el
orquestador consulta primero `models.get` y exige que el modelo declare soporte
para `generateContent`. El nombre debe ser uno devuelto por `models.list`.

Referencias oficiales:

- https://ai.google.dev/api/models
- https://ai.google.dev/api/generate-content
- https://ai.google.dev/gemini-api/docs/generate-content/function-calling

El orquestador utiliza `generateContent` con declaraciones de funciones tipadas.
Gemini nunca recibe acceso directo a Supabase ni a Evolution.

## Prompt y contexto

El prompt exige respuestas breves, cercanas y en el idioma del cliente; prohíbe
inventar servicios, precios, duraciones, profesionales, dirección, horarios o
disponibilidad. Cuando falta información debe preguntar una sola cosa cada vez.

El contexto se limita a:

- identificadores internos del negocio, conversación y ejecución;
- nombre visible opcional;
- idioma configurado;
- últimos 12 mensajes relevantes, con máximo 2.000 caracteres por mensaje.

Los prompts y las respuestas crudas de Gemini no se almacenan ni se registran.

## Idempotencia y concurrencia

`beauty_ai_runs` conserva solamente estado técnico:

- negocio;
- conversación;
- mensaje inbound;
- tipo de operación;
- estado;
- intentos, máximo tres;
- código de error sanitizado;
- mensaje de respuesta, si existe;
- timestamps.

No almacena prompts, respuestas crudas, teléfonos ni payloads.

Un índice único evita ejecuciones duplicadas. La respuesta outbound utiliza una
segunda clave determinista por ejecución. Si una persona toma la conversación
mientras Gemini trabaja, las comprobaciones finales descartan la respuesta antes
de contactar Evolution. `sent`, `delivered` y `read` nunca activan Gemini.

No existen reintentos automáticos infinitos. Los fallos quedan como `failed` y
activan `needs_attention` cuando la conversación todavía está en modo IA.

## Secretos y activación

Configurar manualmente solo en Supabase Edge Functions:

- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `BEAUTY_AI_ENABLED`

No crear variables `VITE_*`. No guardar valores en Git, documentación o logs.

Orden de activación futura:

1. Revisar y aplicar `20260730220027_beauty_ai_orchestration.sql`.
2. Confirmar tabla, RLS, grants, índice único y RPC server-only.
3. Configurar `GEMINI_API_KEY` y un `GEMINI_MODEL` actual confirmado con
   `models.list`.
4. Mantener `BEAUTY_AI_ENABLED=false`.
5. Desplegar `beauty-ai-orchestrator`.
6. Desplegar la versión coordinada de `evolution-beauty-webhook`.
7. Ejecutar pruebas privadas con IA todavía desactivada.
8. Activar `BEAUTY_AI_ENABLED=true` durante una ventana controlada.
9. Probar un único mensaje inbound y revisar ejecución, respuesta e idempotencia.

## Desactivación y rollback

La desactivación inmediata consiste en establecer `BEAUTY_AI_ENABLED=false`; el
webhook seguirá guardando mensajes, pero no creará ni invocará ejecuciones nuevas.

Rollback de código:

1. mantener la flag en `false`;
2. volver a desplegar la versión anterior del webhook;
3. retirar `beauty-ai-orchestrator`;
4. conservar temporalmente `beauty_ai_runs` para auditoría técnica;
5. eliminar tabla y RPC solo mediante una migración posterior revisada.

No es necesario desconectar WhatsApp para desactivar la IA.

## Pruebas remotas pendientes

Antes de una activación real deben probarse:

- flag desactivada sin invocación;
- conversación manual sin invocación;
- duplicado de webhook;
- aislamiento entre dos negocios;
- servicio inexistente;
- disponibilidad vacía y con huecos;
- fallo real y rate limit de Gemini;
- toma manual mientras Gemini está procesando;
- eco outbound de una respuesta IA;
- eventos `sent`, `delivered` y `read`;
- desconexión de Evolution durante el envío;
- rollback mediante la flag.

## Futuras herramientas

La creación, modificación y cancelación de citas requerirán una fase separada con
confirmación explícita, contratos propios, idempotencia transaccional y auditoría.
No deben añadirse al orquestador actual de forma implícita.
