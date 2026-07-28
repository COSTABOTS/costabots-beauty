# COSTABOTS Beauty — esquema en revisión

Esta carpeta contiene el diseño SQL local de COSTABOTS Beauty. **No debe
aplicarse todavía al proyecto Supabase real.**

Está separada deliberadamente de `supabase/migrations` y de
`supabase/functions`. Esas ubicaciones aún contienen material heredado y quedan
fuera del alcance de esta fase.

## Estado de validación local

Las migraciones y el seed se han ejecutado desde una base vacía en PostgreSQL
WASM mediante PGlite: 56 comprobaciones superadas, cero fallos y una prueba
aplazada.

Esta validación **no aplica las migraciones al proyecto Supabase real**. PGlite
utiliza una sola sesión y no demuestra el comportamiento concurrente entre dos
conexiones PostgreSQL reales. La prueba simultánea del advisory lock continúa
pendiente y deberá realizarse en PostgreSQL nativo o en un entorno Supabase
local completamente aislado.

Hasta completar esa prueba y recibir autorización expresa, estos archivos
**no deben copiarse ni moverse a `supabase/migrations`**.

## Orden de revisión

Los archivos deben revisarse y, en una futura base PostgreSQL local desechable,
ejecutarse en este orden:

1. `0001_types.sql`: enums de roles, estados, orígenes, bloqueos y eventos.
2. `0002_businesses_members.sql`: negocios y membresías de `auth.users`.
3. `0003_staff_services.sql`: profesionales, catálogo y asignaciones.
4. `0004_schedules_blocks_customers.sql`: horarios, excepciones y clientes.
5. `0005_appointments.sql`: citas, servicios de cita e historial.
6. `0006_constraints_indexes.sql`: unicidad, búsquedas y agenda.
7. `0007_updated_at_triggers.sql`: mantenimiento de `updated_at`.
8. `0008_auth_helpers.sql`: helpers seguros para membresía y RLS.
9. `0009_rls.sql`: políticas, RLS forzada y grants mínimos.
10. `0010_availability_rpc.sql`: disponibilidad para Manager autenticado.
11. `0011_create_appointment_rpc.sql`: alta transaccional de citas.
12. `0012_bootstrap.sql`: bootstrap administrativo temporal del primer owner.
13. `seed_dev.sql`: datos completamente ficticios y sin dependencia de usuarios.

No se debe saltar el orden porque las migraciones posteriores dependen de tipos,
tablas y funciones anteriores.

## Cómo revisar

- Verificar que cada relación funcional incluye `business_id`.
- Verificar las claves foráneas compuestas que impiden cruzar negocios.
- Revisar por separado grants y políticas RLS.
- Confirmar que las funciones `SECURITY DEFINER` fijan `search_path`, derivan la
  identidad mediante `auth.uid()` y no utilizan SQL dinámico.
- Confirmar que las citas no tienen permisos de escritura directa para
  `authenticated`.
- Revisar los intervalos de disponibilidad alrededor de cambios de horario
  estacional.
- Revisar el bloqueo transaccional y las comprobaciones de conflicto con
  llamadas concurrentes.

La validación PGlite tampoco sustituye una ejecución futura contra una base
local desechable con la misma versión y configuración de PostgreSQL que
Supabase.

## Prueba local futura

Cuando se autorice expresamente:

1. Crear una instancia local desechable, nunca enlazada al proyecto real.
2. Aplicar los archivos en el orden anterior mediante una sesión administrativa
   local.
3. Crear usuarios ficticios en `auth.users`.
4. Ejecutar el bootstrap con uno de esos UUID.
5. Ejecutar `seed_dev.sql`.
6. Probar RLS con JWT ficticios de owner, admin, staff y un usuario externo.
7. Probar disponibilidad, buffers, varios tramos, cierres y concurrencia.
8. Destruir la instancia al terminar.

Esta fase no autoriza Supabase CLI, enlaces remotos, SQL Editor ni cambios en el
proyecto Beauty real.

## Bootstrap del primer owner

`0012_bootstrap.sql` crea una función administrativa temporal. La función:

- exige que el UUID exista previamente en `auth.users`;
- valida zona horaria y moneda;
- reutiliza de forma segura un negocio con el mismo slug únicamente si no
  pertenece a otro owner;
- crea o reactiva la membresía `owner`;
- no concede `EXECUTE` a `public`, `anon` ni `authenticated`.

En una futura sesión administrativa autorizada se ejecutaría una sola vez:

```sql
select public.bootstrap_beauty_business_owner(
  '<UUID_AUTH_USER_EXISTENTE>'::uuid,
  'Nombre del negocio',
  'slug-del-negocio',
  'Europe/Madrid',
  'EUR',
  'es'
);
```

Después:

1. Verificar manualmente el negocio y la membresía owner.
2. Probar que el usuario accede mediante RLS.
3. Eliminar inmediatamente la superficie temporal:

```sql
drop function public.bootstrap_beauty_business_owner(
  uuid, text, text, text, varchar, varchar
);
```

No se abre ninguna política temporal y no se utiliza una clave privilegiada en
el frontend.

## Seed

`seed_dev.sql` crea Luna Beauty Studio, tres profesionales, ocho servicios,
horarios semanales, diez clientes, bloqueos y doce citas con estados variados.
Todos los nombres, teléfonos y UUID son ficticios.

El seed no crea ni busca un `auth.user` y no crea `business_members`. Para probar
RLS debe utilizarse después un usuario local ficticio y el bootstrap separado.

## Riesgos conocidos

- PGlite interpreta PostgreSQL, pero no reproduce sesiones concurrentes reales
  ni toda la configuración específica de Supabase.
- La prueba con dos conexiones PostgreSQL simultáneas sigue pendiente.
- La exclusión de solapamientos depende de que todas las altas pasen por la RPC.
- El MVP admite varios servicios, pero todos usan un único profesional.
- Los horarios extraordinarios positivos todavía no están modelados.
- Los teléfonos necesitan normalización E.164 en una futura API confiable.
- La edición controlada de estados y notas requerirá una RPC específica antes
  de activar el backend.
- Los cambios de rol deben proteger en el futuro al último owner del negocio.
- La entrada futura desde WhatsApp deberá usar una Edge Function segura; no se
  concederá acceso anónimo a estas RPC.

## Promoción futura

Tras revisión, pruebas locales y autorización:

1. Crear un historial Beauty limpio.
2. Trasladar únicamente estas migraciones revisadas a `supabase/migrations`.
3. Excluir formalmente los archivos heredados del historial Beauty.
4. Revisar nuevamente el diff y los destinos antes de cualquier aplicación.

Nada de esta carpeta debe mezclarse automáticamente con el contenido heredado.
