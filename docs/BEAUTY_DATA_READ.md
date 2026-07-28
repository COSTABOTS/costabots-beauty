# Lectura operativa de Supabase Beauty

La fase 3B.2 introduce una capa de repositorios con dos implementaciones:

- `mockBeautyRepository`: conserva los datasets del prototipo.
- `supabaseBeautyRepository`: realiza exclusivamente consultas `select` bajo RLS.

`createBeautyRepository` elige la implementación mediante
`VITE_BEAUTY_DATA_MODE=mock|supabase`. El valor versionado y el entorno local
quedan en `mock` después de las verificaciones. Vercel no se ha modificado.

## Contrato

`BeautyRepository` permite leer:

- negocio;
- profesionales y servicios;
- relación profesional-servicio con precio y duración efectivos;
- horarios semanales;
- bloqueos por rango;
- clientes;
- citas por rango explícito;
- servicios de citas en lote;
- eventos de una cita bajo demanda;
- snapshot operativo agregado para el Manager.

Las consultas obtienen el `business_id` desde `BeautyBusinessProvider`; no se
acepta un identificador libre desde la interfaz. Todas las tablas están
protegidas por RLS.

## Estrategia de carga

El proveedor `BeautyDataProvider` carga el rango operativo
`2026-07-25` (incluido) a `2026-08-01` (excluido), que cubre el seed ficticio
validado. Profesionales, servicios, horarios, bloqueos, clientes y citas se
solicitan en paralelo cuando sus dependencias lo permiten. Los servicios de las
citas se cargan en una sola consulta para todos los IDs visibles.

Los eventos no se descargan con la agenda: se consultan únicamente al abrir el
detalle de una cita.

Los siguientes datos de cliente se derivan en los mappers:

- última visita;
- próxima cita;
- número de citas;
- recurrencia;
- servicios habituales.

## Límites

- No existen métodos de escritura en el repositorio.
- En modo Supabase, las acciones de una cita se sustituyen por una indicación
  de solo lectura.
- Mensajes y automatizaciones siguen usando sus mocks independientes.
- No se conectan Realtime, WhatsApp, Gemini ni Evolution API.
- La prueba interactiva del Manager en modo Supabase requiere un login manual;
  no se guardan ni solicitan credenciales para automatizarla.
