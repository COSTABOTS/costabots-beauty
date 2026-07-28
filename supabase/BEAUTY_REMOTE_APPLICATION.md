# Aplicación inicial de Supabase Beauty

## Destino

- Fecha: 28 de julio de 2026.
- Proyecto Supabase: COSTABOTS BEAUTY.
- Identificador enmascarado: `orixkc...pnux`.
- Supabase CLI: 2.110.0.
- Frontend durante y después de la aplicación: `mock`.

No se utilizaron claves del frontend para administrar la base de datos y no se
desplegaron Edge Functions.

## Historial aplicado

Se aplicaron, en orden, las doce migraciones
`20260728090001`–`20260728090012` de `supabase/migrations`.

Los tres archivos preexistentes quedaron fuera del historial ejecutable,
conservados únicamente en
`supabase/legacy-hospitality-reference/migrations`.

## Resultado

- 11 tablas Beauty.
- 5 enums.
- 22 foreign keys, 11 de ellas compuestas.
- 43 índices.
- 22 políticas.
- RLS habilitado y forzado en las 11 tablas.
- 8 funciones/RPC esperadas.
- Cero grants de tablas Beauty para `anon`.
- Cero permisos `PUBLIC` sobre las funciones sensibles.
- Cero objetos heredados de restaurantes en el esquema `public`.

## Seed ficticio

- 1 negocio: Luna Beauty Studio.
- 3 profesionales.
- 8 servicios.
- 10 clientes.
- 33 tramos de horario.
- 3 bloqueos.
- 12 citas.
- 12 servicios de cita.
- 12 eventos.
- 0 miembros y 0 usuarios creados permanentemente.

## Pruebas remotas

Las pruebas se ejecutaron dentro de una transacción terminada con `ROLLBACK`.
Validaron:

- aislamiento de un usuario externo;
- rechazo de disponibilidad sin membresía;
- bootstrap con usuario ficticio existente;
- rechazo de bootstrap con usuario inexistente;
- cita activa y buffer bloqueando disponibilidad;
- cita cancelada sin bloquear;
- bloqueo individual;
- cierre global;
- creación de una cita con dos servicios y un profesional;
- recálculo de duración y precio desde el catálogo;
- creación de `appointment_services` y evento `created`;
- rechazo de un hueco ocupado;
- rollback ante un servicio de otro negocio.

Después del rollback se verificaron cero usuarios, negocios, citas o fixtures
transitorios.

## Diferencias frente a PGlite

El esquema y las migraciones no necesitaron cambios. El script de prueba remoto
sí necesitó:

- casts explícitos de UUID y enum en consultas con `UNION ALL`;
- un grant temporal sobre una tabla temporal al cambiar al rol
  `authenticated`.

Ambos cambios pertenecen únicamente al harness y desaparecen con el rollback.

La prueba de concurrencia con dos conexiones PostgreSQL reales sigue pendiente.
La presencia y composición del advisory lock fue validada, pero no su
contención simultánea entre sesiones.

## Desarrollo local

1. Mantener `.env.local` fuera de Git.
2. Mantener `VITE_BEAUTY_DATA_MODE=mock`.
3. Instalar dependencias con `npm install` si fuera necesario.
4. Arrancar con `npm run dev`.

La aplicación web no utiliza todavía las tablas, Auth, Realtime ni las RPC
remotas.

