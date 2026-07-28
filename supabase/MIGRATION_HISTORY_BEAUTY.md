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

