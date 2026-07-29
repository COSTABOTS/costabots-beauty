# Escrituras del Manager Beauty

La fase 3B.3 habilita únicamente tres operaciones reales para usuarios
autenticados que pertenecen al negocio activo:

1. Cambio controlado del estado de una cita mediante
   `update_beauty_appointment_status`.
2. Creación de bloqueos mediante `create_beauty_time_block`.
3. Creación atómica de citas mediante la RPC existente
   `create_appointment_with_services`.

El frontend no inserta ni actualiza directamente las tablas operativas. Las RPC
validan pertenencia, rol, negocio, profesional y transiciones. La creación de
citas vuelve a calcular precio y duración en PostgreSQL y utiliza el bloqueo
transaccional ya validado.

## Transiciones de cita

- `pending` → `confirmed`
- `confirmed` → `arrived`
- `confirmed` → `no_show`
- `arrived` → `in_service`
- `in_service` → `completed`

No se aceptan estados arbitrarios. Cada cambio válido genera un
`appointment_event`. Owner y admin pueden gestionar las citas del negocio; un
miembro staff solo puede cambiar las citas que tiene asignadas.

## Bloqueos

Owner y admin pueden crear cierres globales o bloqueos para profesionales. Un
miembro staff solo puede crear pausas, bloqueos personales u otros bloqueos
propios. La aplicación convierte fecha y hora local a `timestamptz` usando la
zona horaria del negocio.

## Modos de datos

El repositorio mock implementa el mismo contrato para conservar la demo sin
acceso remoto. El repositorio Supabase usa exclusivamente las RPC autenticadas.
La selección sigue controlada por `VITE_BEAUTY_DATA_MODE`; `.env.example` y
Vercel continúan configurados en `mock`.

No se han conectado Realtime, WhatsApp, Gemini, Evolution API ni escrituras
adicionales.

## Validación

Las pruebas remotas se ejecutaron con identidades y datos ficticios dentro de
una transacción con rollback. Cubrieron permisos, transiciones, eventos,
bloqueos globales e individuales, aislamiento de usuarios externos y rechazo de
ejecución anónima. La prueba transaccional anterior de creación de citas se
repitió para confirmar disponibilidad, recálculo, conflicto y rollback.

La concurrencia simultánea con dos conexiones PostgreSQL reales continúa
pendiente.
