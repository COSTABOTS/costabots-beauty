# Historial oficial de migraciones Beauty

`supabase/migrations` contiene exclusivamente el historial ejecutable de
COSTABOTS Beauty.

Las doce migraciones se aplicaron correctamente el 28 de julio de 2026 al
proyecto Supabase Beauty enmascarado como `orixkc...pnux`. El historial local y
el remoto coinciden en las versiones `20260728090001` a `20260728090012`.

Correspondencia con el borrador validado:

| Borrador revisado | Migración oficial |
|---|---|
| `0001_types.sql` | `20260728090001_types.sql` |
| `0002_businesses_members.sql` | `20260728090002_businesses_members.sql` |
| `0003_staff_services.sql` | `20260728090003_staff_services.sql` |
| `0004_schedules_blocks_customers.sql` | `20260728090004_schedules_blocks_customers.sql` |
| `0005_appointments.sql` | `20260728090005_appointments.sql` |
| `0006_constraints_indexes.sql` | `20260728090006_constraints_indexes.sql` |
| `0007_updated_at_triggers.sql` | `20260728090007_updated_at_triggers.sql` |
| `0008_auth_helpers.sql` | `20260728090008_auth_helpers.sql` |
| `0009_rls.sql` | `20260728090009_rls.sql` |
| `0010_availability_rpc.sql` | `20260728090010_availability_rpc.sql` |
| `0011_create_appointment_rpc.sql` | `20260728090011_create_appointment_rpc.sql` |
| `0012_bootstrap.sql` | `20260728090012_bootstrap.sql` |

Las copias oficiales deben permanecer byte a byte equivalentes a los archivos
SQL revisados, salvo una corrección futura expresamente documentada.

Los archivos preexistentes se trasladaron, sin alterar su contenido, a
`supabase/legacy-hospitality-reference/migrations`. Esa carpeta es solamente de
referencia y no es consumida por Supabase CLI.

El seed ficticio permanece separado en
`supabase/beauty-review/seed_dev.sql`; no forma parte del historial automático
de migraciones. Se aplicó explícitamente después de las doce migraciones.

La prueba transaccional remota confirmó disponibilidad, bloqueos, citas
canceladas, creación atómica, recálculo de precio/duración y rollback. La prueba
con dos conexiones PostgreSQL simultáneas continúa pendiente.

## Fase 3B.3

El 29 de julio de 2026 se aplicó
`20260729090013_manager_write_rpcs.sql`. Esta migración incorpora
exclusivamente RPC autenticadas para cambiar estados de citas y crear bloqueos
horarios. No abre políticas RLS ni concede ejecución a `anon` o `public`.

La validación transaccional confirmó las transiciones permitidas, la generación
de eventos, los bloqueos globales e individuales, el aislamiento por rol y
negocio y la ausencia de permisos de ejecución para `anon`. Todas las pruebas
usaron datos ficticios con rollback; no quedó ningún usuario ni registro de
prueba.

## Gestión de clientes

El 29 de julio de 2026 se aplicó
`20260729130014_customer_management_rpcs.sql`. Añade las RPC autenticadas
`create_beauty_customer`, `update_beauty_customer` y
`deactivate_beauty_customer`, además de una normalización interna de teléfono.

Las funciones obtienen la identidad mediante `auth.uid()`, validan rol
`owner`/`admin`, mantienen `business_id` fuera de los campos editables,
comprueban el profesional preferido y evitan teléfonos duplicados dentro del
mismo negocio. No conceden ejecución a `anon` o `public` y la desactivación es
lógica (`active = false`), sin borrar historial ni cancelar citas.

## Flujo simplificado de citas

El 29 de julio de 2026 se aplicó
`20260729150015_simplify_appointment_status_flow.sql`. La migración conserva
los valores internos `arrived` e `in_service`, pero limita las transiciones del
Manager al flujo simple del MVP:

- `pending` → `confirmed` o `cancelled`;
- `confirmed` → `completed`, `no_show` o `cancelled`;
- `arrived` → `completed`;
- `in_service` → `completed`.

La RPC continúa validando membresía, rol y negocio, y registra cada transición
aceptada en `appointment_events`.

La validación contra PostgreSQL real detectó que una cancelación también debe
informar `cancelled_at` para satisfacer
`appointments_cancellation_consistency`. La corrección queda representada en
`20260729153016_fix_appointment_cancellation_timestamp.sql`; no altera campos
de cliente, profesional, horario, duración, precio ni negocio.

## Profesionales, servicios y horarios

El 29 de julio de 2026 se aplicó
`20260729170017_staff_services_schedules_management.sql`. Incorpora RPC
autenticadas para crear, editar y desactivar profesionales y servicios,
gestionar la relación `staff_services` y reemplazar de forma transaccional el
horario semanal habitual de un profesional.

Todas las escrituras requieren rol `owner` o `admin`, fijan `search_path`,
mantienen `user_id` fuera de los contratos del frontend y revocan ejecución a
`anon` y `public`. La desactivación es lógica y se rechaza si el profesional o
servicio participa en citas futuras activas. Los horarios conservan la
convención ISO existente (`1 = lunes`, `7 = domingo`), admiten varios tramos
diarios y rechazan intervalos inválidos o solapados.

La primera ejecución de la RPC de horarios en PostgreSQL real detectó que
`WITH ORDINALITY` no puede combinarse con una lista de definición de columnas.
La corrección incremental queda registrada en
`20260729173018_fix_weekly_schedule_overlap_validation.sql`, que sustituye
únicamente esa RPC usando segmentos numerados mediante `row_number()` y
mantiene intactos permisos, validaciones y reemplazo transaccional.

Las ausencias, vacaciones, pausas puntuales y cierres globales continúan
representándose mediante `time_blocks`; no se introduce una tabla paralela.
El frontend de producción permanece en modo `mock` hasta una activación
posterior y controlada.

## Operativa diaria de Agenda

El 29 de julio de 2026 se aplicaron, en orden:

- `20260729200019_agenda_event_types.sql`;
- `20260729201020_agenda_operations.sql`;
- `20260729202021_agenda_status_events.sql`.

Estas migraciones incorporan disponibilidad ordenada para varios servicios,
edición transaccional de citas, cancelación con motivo y gestión de bloqueos.
La disponibilidad suma las duraciones efectivas por profesional, usa los
buffers del primer y último servicio, respeta los distintos tramos semanales,
bloqueos globales o individuales y permite excluir la propia cita al
reprogramarla. La edición conserva `customer_id` y recalcula en servidor
duración, precio, moneda y servicios.

Las escrituras usan `SECURITY DEFINER`, `search_path` fijo, membresía y rol,
advisory lock por negocio/profesional/día local y permisos exclusivos para
`authenticated`; `anon` y `public` permanecen revocados. El historial registra
eventos específicos de reprogramación, cambio de profesional, servicios,
notas, cancelación, confirmación, finalización y no presentado.

Se validaron contra Supabase real la disponibilidad multservicio, una
reprogramación con dos servicios, el recálculo de 180 minutos y 115 EUR, la
persistencia y los eventos generados, además de la edición de un bloqueo. La
prueba estricta con dos conexiones autenticadas simultáneas continúa pendiente:
la protección está implementada mediante advisory lock transaccional, pero una
única sesión de navegador no demuestra por sí sola la carrera real.

Antes de activar Supabase para operaciones de producción debe ejecutarse con
dos sesiones autenticadas distintas, pertenecientes a la misma empresa, una
creación o reprogramación simultánea para el mismo profesional, fecha y hora.
La aceptación exige que solo una operación se complete, que la segunda reciba
un error funcional y comprensible y que no quede ningún solapamiento
persistente.

El frontend de producción y `.env.example` continúan en
`VITE_BEAUTY_DATA_MODE=mock`.

## Perfil básico y onboarding

El 30 de julio de 2026 se aplicó al proyecto Supabase Beauty
`20260730100022_business_profile_management.sql`. Añade la RPC autenticada
`update_beauty_business_profile`, limitada a nombre comercial, teléfono,
email, dirección, zona horaria y moneda.

La función exige una membresía activa con rol `owner` o `admin`, valida la
zona horaria contra `pg_timezone_names`, usa moneda ISO de tres letras y no
expone en su contrato `slug`, propietarios, identificadores ni campos
técnicos. Mantiene `search_path` fijo, revoca ejecución a `public` y `anon` y
solo concede `EXECUTE` a `authenticated`.

El progreso del onboarding no depende de un booleano: el Manager lo calcula
desde el perfil válido, profesionales, servicios, asignaciones y tramos
horarios activos. El frontend de producción continúa en modo `mock`.
