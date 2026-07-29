# Auditoría integral de uso de COSTABOTS Beauty

Fecha: 29 de julio de 2026.

## Alcance y método

Esta auditoría revisa el recorrido completo del Manager, sus repositorios mock y
Supabase, Auth, RLS y RPC hasta la migración 21. Se utilizaron únicamente Luna
Beauty Studio y registros ficticios del seed. No se modificaron la interfaz, el
backend, las migraciones, Vercel ni las variables remotas.

La revisión combina:

- navegación e inspección de la aplicación local en modo `mock`;
- comprobación de formularios, navegación móvil, estados de carga y consola;
- revisión estática de Auth, contextos, repositorios y RPC;
- resultados de las pruebas Supabase realizadas en las fases 3B y Agenda;
- análisis específico del caso de un negocio sin datos;
- evaluación de viabilidad de la prueba de concurrencia pendiente.

El árbol Git estaba limpio al comenzar y `.env.local` y `.env.example`
permanecen en `VITE_BEAUTY_DATA_MODE=mock`.

## Conclusión ejecutiva

El núcleo operativo funciona para un negocio que ya fue creado, tiene owner,
profesionales, servicios, asignaciones y horarios. Un owner puede gestionar
clientes, equipo, catálogo, horarios, bloqueos y citas sin usar el dashboard de
Supabase.

Sin embargo, un negocio nuevo todavía **no puede completar el recorrido desde
cero sin intervención administrativa**. Faltan:

1. alta autoservicio del negocio y primera membresía owner;
2. edición de los datos básicos del negocio;
3. onboarding y estados vacíos que ordenen la configuración;
4. rango de agenda dinámico: actualmente está fijado al 25–31/07/2026;
5. prueba de concurrencia con dos identidades autenticadas distintas.

Recomendación: **no activar aún Supabase para operaciones de producción**. El
modelo de seguridad y las RPC son sólidos, pero los puntos anteriores impiden
un alta real y una operación continuada sin asistencia técnica.

## Recorrido completo

| Paso | Resultado | Evidencia y observaciones |
|---|---|---|
| 1. Iniciar sesión | Correcto | Supabase Auth real, recuperación y persistencia ya validadas. No existe registro público de cuentas. |
| 2. Acceder al negocio | Correcto si ya existe membresía | Una membresía abre directamente el Manager; varias muestran selector. Sin membresía solo se ofrece cerrar sesión. |
| 3. Configurar datos básicos | Bloqueado | “Configuración” y “Perfil del negocio” están deshabilitados como Próximamente. No existe formulario ni RPC específica desde el Manager. |
| 4. Crear profesionales | Correcto | Disponible en Más → Profesionales para owner/admin. Formulario real en Supabase y simulado en mock. |
| 5. Crear servicios | Correcto | Disponible en Más → Servicios. Duración, precio, buffers, moneda y reactivación se validan. |
| 6. Asignar servicios | Correcto con fricción | Se gestiona dentro de cada profesional. Cada servicio requiere su propio botón Guardar y no muestra estado de carga o confirmación por fila. |
| 7. Horarios y jornadas partidas | Correcto | Se permiten varios tramos por día y reemplazo transaccional. “Copiar a toda la semana” sustituye todos los días y necesita una advertencia más explícita. |
| 8. Ausencias o vacaciones | Correcto | Desde Horarios abre el formulario común de `time_blocks`. La distinción conceptual está bien mantenida. |
| 9. Crear cliente | Correcto | Alta real mediante RPC, teléfono normalizado, consentimientos separados y profesional preferido. |
| 10. Crear cita | Correcto con precondiciones | Requiere cliente, profesional, asignación, servicios y horario. El footer fijo mantiene visible la confirmación. |
| 11. Editar cita | Correcto | Se conserva cliente y estado; pueden cambiar profesional, servicios y notas internas. |
| 12. Reprogramar | Correcto | Reutiliza el formulario, excluye la propia cita y vuelve a consultar disponibilidad. |
| 13. Cancelar o finalizar | Correcto | Finalizar usa transición contextual. Cancelar guarda estado, fecha y motivo; el motivo usa un `prompt` nativo poco elegante. |
| 14. Historial de cliente | Correcto | Existe consulta específica y no depende solo de la semana visible. Carga, vacío y error tienen texto. |
| 15. Historial de cita | Correcto | Eventos cargados bajo demanda con estados de carga y error. |
| 16. Crear, editar y eliminar bloqueo | Correcto | Crear se accede fácilmente desde Hoy y desde Horarios; editar/eliminar desde el bloqueo visible en Agenda. Agenda no tiene botón directo para crear bloqueo. |
| 17. Disponibilidad multi-servicio | Correcto | Suma duraciones personalizadas, usa buffers, tramos, bloqueos y conflictos; la RPC recalcula y valida. |
| 18. Cerrar sesión y volver a entrar | Correcto | Validado anteriormente con Auth real. En la revisión actual no se cerró la sesión para no requerir transmitir credenciales. |
| 19. Persistencia | Correcto en funciones probadas | CRUD y agenda refrescan el repositorio tras escribir. La reprogramación, notas, servicios, eventos y bloqueo se verificaron previamente contra Supabase real. |

## Acciones difíciles de encontrar o con demasiados pasos

### Prioridad alta

- Asignar servicios exige abrir Más → Profesionales → Gestionar, desplazarse
  hasta “Servicios asignados” y guardar cada fila por separado.
- El formulario de profesional y todas sus asignaciones aparecen después de la
  lista completa. En móvil, con muchos profesionales o servicios, el usuario
  debe desplazarse bastante para encontrar el editor recién abierto.
- Crear un bloqueo desde Agenda no tiene acción directa; se debe volver a Hoy o
  entrar por Horarios → Ausencia o vacaciones.
- La edición del negocio aparece en Más, pero está deshabilitada. Su ubicación
  promete una capacidad que no existe.

### Prioridad media

- El alta de servicio expone desde el inicio moneda, buffers, reserva online y
  reactivación. Para un primer servicio es más información de la necesaria.
- “Copiar a toda la semana” reemplaza la semana completa, no solo días vacíos.
  El texto no explica el alcance destructivo.
- Guardar un horario vacío puede eliminar todos los tramos del profesional sin
  confirmación específica.
- La cancelación utiliza un diálogo nativo para el motivo. Conviene un pequeño
  formulario con motivos predefinidos y “Otro”.
- Editar y reprogramar se presentan como una única acción. Es funcional, pero
  para algunos usuarios “Editar o reprogramar” puede parecer más amplio de lo
  necesario.

## Estados de carga, errores y reintentos

### Correctos

- Auth y carga de membresías tienen pantalla de carga.
- Error de membresía ofrece reintentar y cerrar sesión.
- Error de carga operativa ofrece “Volver a intentar”.
- Citas, clientes y bloqueos muestran errores funcionales, no SQL crudo.
- Nueva cita mantiene visibles estado deshabilitado, ayuda, carga y errores.
- Historiales de cita y cliente distinguen carga, vacío y error.
- La consola del recorrido auditado no mostró errores ni warnings.

### Mejorables

- Guardar una asignación profesional–servicio no muestra loading, éxito ni
  bloqueo contra doble toque.
- Formularios inline de profesionales y servicios no llevan el foco al editor
  ni anuncian que se abrió más abajo.
- Tras guardar horarios no aparece confirmación persistente en la propia
  pantalla.
- No existe una acción general de reintento si un refresh posterior a una
  escritura falla después de que la RPC ya haya terminado.

## Coherencia entre Hoy, Agenda, Clientes y Más

- Hoy y Agenda comparten tarjetas y acciones contextuales de cita: correcto.
- Clientes permite crear una cita con el cliente preseleccionado: correcto.
- El detalle de cita y el historial de cliente reutilizan los mismos datos y
  estados: correcto.
- Agenda permite crear cita, pero no crear bloqueo; Hoy permite ambos.
- Más concentra la configuración operativa, pero mezcla funciones reales
  (Servicios, Profesionales, Horarios) con entradas deshabilitadas
  (Configuración, Perfil) y una demo conceptual (Automatizaciones).
- Mensajes está correctamente marcado como no conectado en modo Supabase; no es
  parte de esta activación.

## Navegación móvil

La navegación inferior y los formularios principales son utilizables en móvil,
sin errores de consola ni desbordamiento horizontal detectado en el recorrido.
El footer de nueva cita mantiene la acción principal visible.

Problemas de ergonomía:

- los editores inline aparecen al final de listas potencialmente largas;
- la gestión de asignaciones puede requerir muchos desplazamientos y toques;
- el editor semanal de siete días es largo y carece de resumen compacto;
- no existe una barra o checklist que indique qué parte de la configuración
  falta.

## Negocio vacío

### Comportamiento actual

| Área vacía | Estado actual | Evaluación |
|---|---|---|
| Sin membresía/negocio | Mensaje “No tienes acceso” y cerrar sesión | Correcto para invitado, insuficiente para un nuevo owner. |
| Hoy sin citas | “Hoy no hay citas. La agenda está libre” | Correcto, pero no explica que faltan datos de configuración. |
| Agenda sin citas | “Un día tranquilo” | Correcto para un salón configurado; engañoso si no hay profesionales/horarios. |
| Clientes vacíos | “Sin clientes” | Existe, pero el texto habla de búsqueda y no invita claramente a crear el primero. |
| Profesionales vacíos | Lista en blanco y botón Nuevo | Funcional, sin explicación ni CTA contextual. |
| Servicios vacíos | Lista en blanco y botón Nuevo | Funcional, sin explicar que después deben asignarse. |
| Asignaciones vacías | Servicios desmarcados dentro del profesional | No existe aviso de que sin asignación no habrá disponibilidad. |
| Horarios vacíos | Siete días como “Día libre” | Comprensible, pero no advierte que el profesional no podrá recibir citas. |
| Formulario de cita sin clientes | Selector vacío y botón deshabilitado | Parece un formulario roto; no ofrece “Crear primer cliente”. |
| Formulario sin profesionales/servicios | Controles vacíos y ayuda genérica | No dirige a Más ni identifica la precondición exacta. |

### Estados vacíos que deben añadirse

1. Panel de configuración inicial en Hoy cuando falten prerrequisitos.
2. Estado vacío de Profesionales con CTA “Crear primer profesional”.
3. Estado vacío de Servicios con CTA y explicación del siguiente paso.
4. Aviso en asignaciones: “Activa al menos un servicio para este profesional”.
5. Aviso en Horarios: “Sin horario no se ofrecerán citas”.
6. Bloqueo orientado del formulario de cita con enlaces a completar cliente,
   profesional, servicios o horario.
7. Distinción en Agenda entre “día sin citas” y “negocio aún sin configurar”.

## Propuesta mínima de onboarding

### Principios

- Mobile first, una tarea principal por pantalla.
- Reutilizar `StaffEditor`, `ServiceEditor`, asignaciones y editor semanal.
- Guardar cada paso inmediatamente mediante los repositorios existentes.
- Permitir salir y continuar desde el primer paso incompleto.
- Mostrar progreso `Paso n de 5`.
- Permitir saltar descripción, contacto, buffers, reactivación y días cerrados.
- No duplicar validaciones ni contratos.

### Pasos

1. **Datos del negocio**
   - Nombre, zona horaria, moneda e idioma.
   - Nombre obligatorio; el resto con valores sugeridos.
   - Requiere nueva operación segura de actualización del negocio.

2. **Primer profesional**
   - Reutiliza `StaffEditor`.
   - Solo nombre obligatorio; contacto y color opcionales.

3. **Primeros servicios**
   - Reutiliza `ServiceEditor` en modo simplificado.
   - Nombre, duración y precio visibles.
   - Buffers y reactivación bajo “Opciones avanzadas”.
   - Al guardar, asignar explícitamente los servicios seleccionados al primer
     profesional reutilizando `setStaffService`.

4. **Horario**
   - Reutiliza el editor semanal.
   - Plantillas rápidas: lunes–viernes, lunes–sábado o personalizado.
   - Permite jornadas partidas.

5. **Finalización**
   - Resumen de negocio, profesionales, servicios asignados y días con horario.
   - CTA “Ir a mi agenda”.
   - Accesos opcionales para crear primer cliente o primera cita.

### Guardar y continuar después

No hace falta una tabla de progreso para el MVP. El siguiente paso puede
derivarse de los datos reales cada vez que se entra. Una marca opcional
`onboarding_dismissed_at` solo sería necesaria para permitir ocultarlo después
de cumplir las condiciones.

### Condiciones exactas de onboarding completo

El onboarding se considera completo cuando el negocio activo cumple todo:

1. `beauty_businesses.name` no está vacío.
2. Tiene zona horaria válida y moneda ISO de tres caracteres.
3. Existe al menos un `staff_member` activo.
4. Existe al menos un `beauty_service` activo.
5. Existe al menos un `staff_service` activo que relacione un profesional y un
   servicio activos.
6. Ese profesional tiene al menos un tramo `staff_schedule` activo y válido.

No son obligatorios para completar onboarding: clientes, citas, teléfono,
email, vacaciones, automatizaciones, WhatsApp ni consentimiento comercial.

El onboarding desaparece cuando se cumplen las seis condiciones. Si después se
desactiva la única asignación u horario, debe mostrarse un aviso operativo, no
reiniciar forzosamente todo el asistente.

## Concurrencia

### Preparación revisada

Las RPC de creación y reprogramación:

- validan sesión, negocio, rol y disponibilidad;
- recalculan los datos en servidor;
- usan `pg_advisory_xact_lock` por negocio, profesional y fecha local;
- escriben de forma atómica;
- rechazan el conflicto con un error funcional mapeado por el repositorio.

### Resultado

La prueba estricta **no se ejecutó** porque actualmente solo hay una identidad
de desarrollo disponible en Auth y el Manager no permite crear una segunda
cuenta o invitarla sin intervención administrativa. Crearla mediante
`service_role`, dashboard o credenciales administrativas habría incumplido el
alcance seguro de esta auditoría.

La prueba continúa pendiente y debe hacerse antes de producción con:

1. dos usuarios ficticios autenticados distintos;
2. membresía activa en el mismo negocio;
3. mismo profesional, fecha y hora;
4. dos creaciones o reprogramaciones disparadas simultáneamente;
5. exactamente una operación completada;
6. segunda operación rechazada con “Ese hueco ya no está disponible o existe
   un bloqueo”;
7. una consulta final que demuestre ausencia de solapamiento persistente;
8. comprobación de un solo conjunto de servicios y eventos para la operación
   ganadora.

No debe eliminarse ni relajarse el advisory lock para realizarla.

## Bloqueadores para activar Supabase en producción

### P0 — críticos

1. **Rango fijo de datos y formularios.** `beautyDataRange` está fijado a
   `2026-07-25`–`2026-08-01`. Después de esa semana la agenda no cargará ni
   permitirá crear citas normales.
2. **Sin alta autoservicio de negocio/owner.** El bootstrap sigue siendo
   administrativo; un usuario nuevo sin membresía no puede crear su negocio.
3. **Datos básicos no editables.** Configuración y Perfil están deshabilitados.
4. **Concurrencia real pendiente.** Debe ejecutarse con dos sesiones distintas.
5. **Negocio vacío sin guía.** Se puede entrar en pantallas aparentemente rotas
   o intentar una cita sin comprender qué configuración falta.

### P1 — importantes

1. Añadir onboarding derivado de datos.
2. Crear estados vacíos con CTA y dependencias claras.
3. Añadir acción “Nuevo bloqueo” en Agenda.
4. Mejorar confirmación de cancelación y operaciones destructivas de horario.
5. Añadir loading/éxito y prevención de doble envío en asignaciones.
6. Convertir editores inline en panel/modal móvil o llevar el foco al editor.
7. Permitir invitar o crear de forma segura una segunda cuenta del negocio.

### P2 — mejoras rápidas

1. Ocultar campos avanzados al crear el primer servicio.
2. Renombrar “Copiar a toda la semana” a “Reemplazar toda la semana con este
   horario” y pedir confirmación.
3. Cambiar el vacío de Clientes a “Aún no tienes clientes” con CTA.
4. Mostrar un resumen “X profesionales, Y servicios asignados, Z días con
   horario”.
5. Añadir toasts de éxito a horarios y asignaciones.

## Recomendación de activación

No es seguro activar todavía `VITE_BEAUTY_DATA_MODE=supabase` en producción
para clientes reales.

Antes de hacerlo deben resolverse como mínimo:

- rango dinámico de agenda;
- alta/configuración inicial sin dashboard;
- datos básicos editables;
- guía del negocio vacío;
- prueba de concurrencia con dos usuarios ficticios.

Tras resolver esos puntos, repetir este recorrido en un negocio ficticio nuevo,
desde cero, y verificar que no se necesita SQL, dashboard ni credencial
administrativa durante la operación normal.
