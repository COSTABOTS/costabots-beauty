# Inventario funcional de COSTABOTS Beauty

Fecha de auditoría: 29 de julio de 2026.

Alcance: interfaz React actual, Auth, repositorios mock/Supabase y esquema Beauty
versionado. Esta auditoría no modifica la interfaz, Supabase, Vercel ni las
migraciones.

## Leyenda de estados

- **Real Supabase**: lee o escribe el proyecto Beauty mediante Auth, RLS, tablas
  o RPC.
- **Funcional mock**: funciona usando el repositorio mock, sin persistencia tras
  reiniciar la aplicación.
- **Simulado local**: cambia estado React o muestra un toast, pero no pasa por el
  repositorio operativo.
- **Visible no implementado**: parece accionable pero no produce la acción
  esperada.
- **Deshabilitado**: se presenta explícitamente sin permitir interacción.
- **Pendiente de definición**: falta decidir contrato, permisos o experiencia.
- **Fuera del MVP**: no debería presentarse como disponible en el MVP inicial.

## Resumen ejecutivo

Auth, selección de negocio y lectura operativa ya tienen implementación real.
La fase 3B.3 añade tres escrituras reales cuando
`VITE_BEAUTY_DATA_MODE=supabase`: crear cita, crear bloqueo y cambiar el estado
de una cita. El modo configurado por defecto continúa siendo `mock`.

Mensajes, estado de la recepcionista IA, automatizaciones y algunas métricas son
completamente simulados. Varias entradas de “Más” y el botón “Nuevo cliente”
parecen activas aunque todavía no tienen funcionalidad.

Riesgos principales:

1. “IA en línea” y “Recepcionista IA activa” afirman un estado externo que no se
   consulta.
2. “Huecos”, “Pendientes”, disponibilidad agregada y estadísticas de
   automatización muestran cifras fijas.
3. Los filtros de Mensajes no filtran.
4. Los toggles de automatización parecen guardar, pero solo viven en memoria.
5. El botón “Nuevo cliente” no tiene `onClick`.
6. Las filas de Servicios, Profesionales, Horarios, Configuración y Perfil solo
   muestran un toast.
7. En modo Supabase, el historial de cliente representa únicamente el intervalo
   cargado, no el historial completo.
8. La agenda solo admite cuatro fechas fijas y contiene un hueco disponible
   inyectado como demo.

## Inventario completo

### Acceso, sesión y selección de negocio

| Pantalla | Elemento visible | Acción esperada | Estado actual | Backend necesario | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| Login | Correo y contraseña | Iniciar sesión | Real Supabase | Supabase Auth | Bajo | Mantener |
| Login | Ojo mostrar/ocultar contraseña | Alternar visibilidad | Funcional local | Ninguno | Bajo | Mantener |
| Login | Iniciar sesión | Validar credenciales y abrir Manager | Real Supabase | Supabase Auth | Bajo | Mantener |
| Login | ¿Has olvidado tu contraseña? | Abrir recuperación | Real Supabase | Supabase Auth | Bajo | Mantener |
| Recuperación | Enviar enlace | Solicitar correo de recuperación | Real Supabase | Supabase Auth y URL Configuration | Bajo | Mantener |
| Recuperación | Volver al login/inicio | Regresar al acceso | Funcional local | Ninguno | Bajo | Mantener |
| Nueva contraseña | Mostrar contraseña | Alternar visibilidad | Funcional local | Ninguno | Bajo | Mantener |
| Nueva contraseña | Guardar contraseña | Actualizar contraseña | Real Supabase | Supabase Auth | Bajo | Mantener |
| Carga Auth | Comprobando sesión/negocio | Informar de carga | Real Supabase | Auth, `business_members`, `beauty_businesses` | Bajo | Mantener |
| Error de membresía | Volver a intentar | Repetir lectura de membresías | Real Supabase | `business_members`, `beauty_businesses` | Bajo | Mantener |
| Error/sin membresía | Cerrar sesión | Finalizar sesión | Real Supabase | Supabase Auth | Bajo | Mantener |
| Selector de negocio | Tarjeta con nombre y rol | Elegir negocio activo | Real Supabase | `business_members`, `beauty_businesses` | Bajo | Mantener |
| Más | Cerrar sesión | Finalizar sesión y limpiar datos | Real Supabase | Supabase Auth | Bajo | Mantener |

### Navegación global

| Pantalla | Elemento visible | Acción esperada | Estado actual | Backend necesario | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| Todas | Hoy | Abrir resumen diario | Funcional local con datos del repositorio activo | Ninguno adicional | Bajo | Mantener |
| Todas | Agenda | Abrir agenda | Funcional local con lecturas reales en Supabase | Tablas operativas actuales | Bajo | Mantener |
| Todas | Clientes | Abrir listado | Funcional local con lectura real | `customers`, citas del rango | Bajo | Mantener |
| Todas | Mensajes | Abrir bandeja | Simulado local | Conversaciones y mensajes | Alto | Marcar “Demo” u ocultar en modo Supabase |
| Todas | Más | Abrir menú | Funcional local | Ninguno | Bajo | Mantener, corrigiendo sus entradas |
| Modales | X y clic en fondo | Cerrar modal | Funcional local | Ninguno | Bajo | Mantener |

### Hoy

| Pantalla | Elemento visible | Acción esperada | Estado actual | Backend necesario | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| Hoy | Símbolo de perfil | Abrir perfil/configuración | Navega a Más | Ninguno | Bajo | Mantener |
| Hoy | Recepcionista IA activa / En línea | Mostrar estado real y abrir Mensajes | Navega a Mensajes, estado fijo | Estado de integración WhatsApp/IA | Muy alto | Deshabilitar como “Próximamente” hasta disponer de health/status real |
| Hoy | Citas | Mostrar total del día | Derivado del rango cargado | `appointments` | Bajo | Mantener |
| Hoy | Confirmadas | Mostrar confirmadas del día | Derivado del rango cargado | `appointments` | Bajo | Mantener |
| Hoy | Huecos: 4 | Mostrar disponibilidad real | Cifra fija | RPC agregada o consultas repetidas de disponibilidad | Alto | Ocultar hasta calcular |
| Hoy | Pendientes: 3 | Mostrar mensajes pendientes | Cifra fija | Conversaciones/mensajes | Alto | Ocultar hasta implementar Mensajes |
| Hoy | Ver agenda | Abrir Agenda | Funcional local | Ninguno | Bajo | Mantener |
| Hoy | Flecha próxima cita | Abrir detalle | Funcional en ambos modos | Lecturas actuales | Bajo | Mantener |
| Hoy | Tarjetas de citas / icono `…` | Abrir detalle/menú contextual | Toda la tarjeta abre detalle; `…` es decorativo | Ninguno para detalle; RPC para acciones futuras | Medio | Sustituir `…` por chevron o implementar menú |
| Hoy | Nueva cita | Abrir formulario y crear | Funcional mock; Real Supabase mediante RPC | `get_service_availability`, `create_appointment_with_services` | Bajo/medio | Mantener |
| Hoy | Bloquear horario | Abrir formulario y guardar | Funcional mock; Real Supabase mediante RPC | `create_beauty_time_block`, `time_blocks` | Bajo/medio | Mantener |
| Hoy | Abrir mensajes | Abrir bandeja | Simulado local | Conversaciones/mensajes + WhatsApp | Alto | Etiquetar “Demo” u ocultar |
| Hoy | Agenda completa | Abrir Agenda | Funcional local | Ninguno | Bajo | Mantener |

### Agenda

| Pantalla | Elemento visible | Acción esperada | Estado actual | Backend necesario | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| Agenda | Hoy | Ir a fecha actual | Va a `2026-07-28`, fecha demo fija | Cálculo de fecha en zona del negocio | Alto cuando pase la fecha demo | Implementar fecha real |
| Agenda | Día anterior/siguiente | Navegar calendario | Solo cuatro fechas codificadas | Carga dinámica por intervalo | Alto | Implementar calendario/rango real |
| Agenda | Todos/profesionales | Filtrar agenda | Funcional local sobre datos cargados | Ninguno adicional | Bajo | Mantener |
| Agenda | “N citas” | Contar citas filtradas | Funcional | `appointments` | Bajo | Mantener |
| Agenda | “3 h disponibles” | Mostrar huecos reales | Texto fijo | Disponibilidad agregada | Alto | Ocultar hasta calcular |
| Agenda | Tarjeta de cita | Abrir detalle | Funcional ambos modos | Lecturas actuales | Bajo | Mantener |
| Agenda | Hueco “Disponible 11:35–12:00” | Mostrar disponibilidad real | Inyectado localmente tras la segunda cita | `get_service_availability` | Muy alto | Eliminar de la vista real; mantener solo en demo claramente marcada |
| Agenda | Bloqueos visibles | Mostrar excepciones | Funcional mock; lectura real Supabase | `time_blocks` | Bajo | Mantener |
| Agenda | Crear cita | Esperable desde agenda | No existe botón en Agenda | RPC existentes | Medio | Implementar acceso directo en MVP |
| Agenda | Crear bloqueo | Esperable desde agenda | No existe botón en Agenda | RPC existente | Medio | Implementar acceso directo en MVP |
| Agenda | Editar bloqueo | Cambiar intervalo/tipo/notas | No existe | Nueva RPC específica sobre `time_blocks` | Bajo ahora | Implementar después de eliminar bloqueo |
| Agenda | Eliminar bloqueo | Liberar intervalo | No existe | Nueva RPC segura de borrado/desactivación | Medio | Implementar en MVP operativo |
| Agenda | Reprogramar cita | Cambiar fecha/hora | No existe | Nueva RPC transaccional de reprogramación + evento | Medio | Implementar en MVP |
| Agenda | Cancelar cita | Cancelar y liberar hueco | No existe | Nueva RPC de cancelación + evento | Alto operacional | Implementar en MVP |

### Nueva cita

| Pantalla | Elemento visible | Acción esperada | Estado actual | Backend necesario | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| Modal Nueva cita | Cliente | Seleccionar cliente existente | Funcional ambos modos | `customers` | Bajo | Mantener |
| Modal Nueva cita | Profesional | Seleccionar profesional | Funcional ambos modos | `staff_members` | Bajo | Mantener |
| Modal Nueva cita | Fecha | Seleccionar fecha | Funcional, limitada al 25–31/07/2026 | Rango dinámico | Alto fuera del prototipo | Eliminar límites fijos |
| Modal Nueva cita | Servicios | Seleccionar uno o varios | Funcional ambos modos | `beauty_services`, `staff_services` | Bajo | Mantener |
| Modal Nueva cita | Duración/total | Previsualizar totales | Mock usa catálogo; Supabase usa asignaciones cargadas | RPC vuelve a recalcular | Medio | Mantener indicando “estimado” |
| Modal Nueva cita | Consultar horarios | Obtener disponibilidad | Funcional mock; Real Supabase | `get_service_availability` | Medio | Mantener |
| Modal Nueva cita | Horas disponibles | Elegir hora | Funcional | RPC de disponibilidad | Medio | Mantener |
| Modal Nueva cita | Notas | Guardar nota del cliente | Funcional mock; Real Supabase | `appointments.customer_notes` mediante RPC | Bajo | Mantener |
| Modal Nueva cita | Crear cita | Confirmar y crear atómicamente | Funcional mock; Real Supabase | `create_appointment_with_services` | Bajo | Mantener |
| Modal Nueva cita | Varios servicios | Validar hueco conjunto | La consulta inicial usa el primer servicio; la RPC final valida el conjunto | RPC de disponibilidad multi-servicio futura | Medio | Documentar y mejorar antes de producción |
| Modal Nueva cita | Cliente nuevo | Crear durante el flujo | No existe | RPC segura de cliente | Bajo | Posponer; usar clientes existentes en MVP |

### Nuevo bloqueo

| Pantalla | Elemento visible | Acción esperada | Estado actual | Backend necesario | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| Modal Nuevo bloqueo | Profesional/negocio completo | Elegir alcance | Funcional mock; Real Supabase con permisos | `staff_members`, RPC de bloqueo | Medio para staff | Mantener para owner/admin; revisar identidad staff |
| Modal Nuevo bloqueo | Fecha | Elegir día | Funcional, limitada al 25–31/07/2026 | Rango dinámico | Alto fuera del prototipo | Eliminar límites fijos |
| Modal Nuevo bloqueo | Tipo | Pausa, ausencia, vacaciones, personal, cierre u otro | Funcional ambos modos | Enum y `time_blocks` | Bajo | Mantener |
| Modal Nuevo bloqueo | Inicio/fin | Definir intervalo | Funcional y validado | RPC + constraint | Bajo | Mantener |
| Modal Nuevo bloqueo | Motivo/notas | Documentar excepción | Funcional; el mapper de lectura no muestra notas | `time_blocks.reason/notes` | Bajo | Mantener; añadir detalle futuro |
| Modal Nuevo bloqueo | Guardar bloqueo | Persistir excepción | Funcional mock; Real Supabase | `create_beauty_time_block` | Bajo | Mantener |
| Modal Nuevo bloqueo | Rol staff | Crear solo bloqueo propio | Backend lo valida; UI no conoce el `staff_member_id` del usuario y parte del primer profesional | `business_members.staff_member_id` | Alto para cuentas staff | Ocultar formulario a staff hasta resolver asociación/selector |

### Clientes

| Pantalla | Elemento visible | Acción esperada | Estado actual | Backend necesario | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| Clientes | + Nuevo cliente | Abrir alta de cliente | Visible sin `onClick` | Nueva RPC de alta sobre `customers` | Muy alto | Deshabilitar con “Próximamente” inmediatamente |
| Clientes | Buscar | Filtrar por nombre/teléfono | Funcional local sobre datos cargados | Ninguno adicional | Bajo | Mantener |
| Clientes | Fila de cliente | Abrir ficha | Funcional ambos modos | `customers` + citas del rango | Bajo | Mantener |
| Ficha cliente | Contacto | Mostrar teléfono | Lectura real, enmascarado | `customers.phone` | Bajo | Mantener |
| Ficha cliente | Servicios habituales | Mostrar hábitos | Mock completo; Supabase derivado solo del rango cargado | Consulta histórica agregada | Alto por interpretación | Etiquetar “En el periodo cargado” |
| Ficha cliente | Profesional preferido | Mostrar preferencia | Real si existe | `customers.preferred_staff_member_id` | Bajo | Mantener |
| Ficha cliente | Próxima reactivación | Mostrar siguiente contacto | Mock ficticio; Supabase siempre “Pendiente de configurar” | Reglas/ejecuciones de reactivación | Alto | Ocultar en Supabase |
| Ficha cliente | Consentimiento mensajes | Mostrar consentimiento | Real, pero combina marketing o recordatorios en un único sí/no | `marketing_consent`, `reminder_consent` | Medio | Separar ambos consentimientos |
| Ficha cliente | Notas | Mostrar notas | Lectura real | `customers.notes` | Bajo | Mantener |
| Ficha cliente | Historial de citas | Ver historial completo | Solo citas dentro del rango global cargado | Consulta paginada por cliente | Alto | Renombrar “Citas del periodo” o implementar historial real |
| Ficha cliente | Cita histórica | Abrir detalle | Funcional si la cita sigue cargada | Lecturas actuales | Bajo | Mantener |
| Clientes/ficha | Crear cita desde cliente | Abrir cita con cliente preseleccionado | No existe | RPC existente | Bajo | Implementar en MVP |
| Clientes/ficha | Editar cliente | Cambiar datos/notas/preferencia | No existe | Nueva RPC segura sobre `customers` | Medio | Implementar en MVP |
| Clientes/ficha | Desactivar/eliminar | Evitar nuevas comunicaciones y ocultar | No existe | RPC de desactivación; no borrado físico | Medio | Implementar desactivación, no eliminación |
| Clientes/ficha | WhatsApp | Abrir conversación | No existe | Conversaciones + Evolution API | Medio | Posponer hasta WhatsApp |
| Clientes/ficha | Llamar | Iniciar llamada | No existe | Enlace `tel:` y permisos UX | Bajo | Implementar solo cuando se muestre teléfono autorizado |

### Mensajes

| Pantalla | Elemento visible | Acción esperada | Estado actual | Backend necesario | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| Mensajes | IA en línea | Estado operativo real | Fijo | Health/configuración Evolution + agente | Muy alto | Sustituir por “Demo” u ocultar |
| Mensajes | Banner requiere atención | Mostrar conversaciones urgentes | Derivado de conversaciones mock | Conversaciones persistidas | Alto | Ocultar en modo Supabase |
| Mensajes | Todas | Mostrar todas | Parece activa; no mantiene filtro explícito | Estado/filtro local | Medio | Implementar si la bandeja sigue visible |
| Mensajes | Pendientes | Filtrar pendientes | Botón sin acción | Conversaciones persistidas | Alto | Deshabilitar |
| Mensajes | Atendidas | Filtrar atendidas | Botón sin acción | Conversaciones persistidas | Alto | Deshabilitar |
| Mensajes | Fila conversación | Abrir chat | Funcional solo sobre mocks | Tablas de conversaciones/mensajes | Alto | Etiquetar toda la sección como demo |
| Conversación | Mensajes/burbujas | Mostrar conversación real | Mock | Mensajes + Evolution API | Alto | Ocultar en Supabase |
| Conversación | Campo escribir | Escribir mensaje | Deshabilitado | Envío seguro vía Edge Function/Evolution | Bajo por estar deshabilitado | Mantener deshabilitado con “Próximamente” |
| Conversación | Botón enviar | Enviar WhatsApp | Deshabilitado | Edge Function + Evolution API + auditoría | Bajo por estar deshabilitado | Mantener deshabilitado |
| Conversación | Tomar conversación | Asignar intervención humana | Solo cambia estado React y pone no leídos a cero | Estado/propietario de conversación | Muy alto | Deshabilitar hasta persistencia real |
| Conversación | Devolver a la IA | Reactivar agente | Solo cambia estado React | Orquestación IA/conversación | Muy alto | Deshabilitar hasta persistencia real |
| Mensajes | Marcar como leída | Actualizar no leídos | Ocurre implícitamente al tomar/devolver, solo local | Read receipts/estado conversación | Alto | Definir e implementar |
| Mensajes | Adjuntos/fotografías | Ver/enviar archivos | No existe | Storage, tabla de adjuntos, Evolution | Medio | Fuera del primer MVP operativo |
| Mensajes | Estados de conversación | IA, espera, intervención, humano, cerrada | Mock | Enum/tabla de conversaciones | Alto | Diseñar antes de exponer |

### Más y automatizaciones

| Pantalla | Elemento visible | Acción esperada | Estado actual | Backend necesario | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| Más | Servicios | Gestionar catálogo | Solo toast “próxima fase” | `beauty_services`, `staff_services` + RPC CRUD | Alto | Deshabilitar con “Próximamente” |
| Más | Profesionales | Gestionar equipo | Solo toast | `staff_members`, membresías, RPC CRUD | Alto | Deshabilitar con “Próximamente” |
| Más | Horarios | Gestionar jornada, pausas y ausencias | Solo toast | `staff_schedules`, `time_blocks` | Alto | Implementar pronto o deshabilitar |
| Más | Automatizaciones | Abrir reglas | Abre pantalla simulada | Nuevas tablas y motor de jobs | Muy alto | Etiquetar “Demo” o deshabilitar |
| Más | Configuración | Preferencias del negocio | Solo toast | `beauty_businesses` + campos/RPC | Alto | Deshabilitar |
| Más | Perfil del negocio | Ver/editar perfil | Solo toast | `beauty_businesses` + RPC | Alto | Deshabilitar |
| Más | Estadísticas | Consultar rendimiento | No existe entrada; métricas solo en automatizaciones | Consultas agregadas y datos de mensajes | Bajo ahora | Fuera del MVP inicial |
| Automatizaciones | Volver | Regresar a Más | Funcional local | Ninguno | Bajo | Mantener si se conserva demo |
| Automatizaciones | Métricas del mes | Mostrar impacto real | Cuatro cifras fijas | Ejecuciones/eventos/atribución | Muy alto | Ocultar |
| Automatizaciones | Toggles | Activar/desactivar reglas | Solo estado React | Tabla de reglas + RPC | Muy alto | Deshabilitar con “Demo” |

### Detalle de cita

| Pantalla | Elemento visible | Acción esperada | Estado actual | Backend necesario | Riesgo | Recomendación |
|---|---|---|---|---|---|---|
| Detalle cita | Cliente/estado | Mostrar identidad y estado | Real según repositorio | `appointments`, `customers` | Bajo | Mantener |
| Detalle cita | Profesional | Mostrar asignación | Real | `staff_members` | Bajo | Mantener |
| Detalle cita | Horario/duración | Mostrar snapshot | Real | `appointments` | Bajo | Mantener |
| Detalle cita | Precio | Mostrar snapshot | Real | `appointments`, `appointment_services` | Bajo | Mantener |
| Detalle cita | Origen | Mostrar canal | Real | `appointments.source` | Bajo | Mantener |
| Detalle cita | Teléfono | Mostrar contacto enmascarado | Real | `customers.phone` | Bajo | Mantener |
| Detalle cita | Notas | Mostrar notas | Real; prioriza nota cliente sobre interna | Columnas existentes | Medio | Separar notas cliente/internas |
| Detalle cita | Servicios | Mostrar snapshots | Real | `appointment_services` | Bajo | Mantener |
| Detalle cita | Fotografía de referencia | Abrir/ver foto | En mock solo muestra aviso; Supabase no mapea fotos | Storage + tabla adjuntos | Alto si aparece | Mantener explícitamente como demo u ocultar |
| Detalle cita | Historial | Ver eventos | Mock local; Real Supabase bajo demanda | `appointment_events` | Bajo | Mantener |
| Detalle cita | Confirmar/Marcar llegada/Iniciar/Finalizar/No presentado | Cambiar estado permitido | Funcional mock; Real Supabase por RPC | `update_beauty_appointment_status` | Bajo | Mantener |
| Detalle cita | Abrir conversación | Abrir chat del cliente | Solo aparece en mock y usa conversaciones mock | Conversaciones reales | Alto | Mantener oculto en Supabase |
| Detalle cita | Llamar | Iniciar llamada | Solo aparece en mock y muestra toast | `tel:` | Medio | Eliminar del mock o marcar “Próximamente” |
| Detalle cita | Editar | Cambiar datos | No existe | Nueva RPC transaccional | Medio | Implementar selectivamente |
| Detalle cita | Reprogramar | Cambiar hora | No existe | Nueva RPC con disponibilidad, lock y evento | Alto operacional | Implementar en MVP |
| Detalle cita | Cancelar | Cancelar y liberar hueco | No existe | Nueva RPC + motivo + evento | Alto operacional | Implementar en MVP |
| Detalle cita | Añadir/editar notas | Guardar notas | No existe | RPC limitada + `appointment_event` | Medio | Implementar en MVP |

## Estados de interfaz

| Estado | Implementación actual | Observación |
|---|---|---|
| Carga de Auth | Real | Espera sesión de Supabase |
| Sin sesión | Real | Login y recuperación |
| Error de Auth | Real | Mensaje seguro, sin detalles internos |
| Carga de membresía | Real | Consulta negocio/membresía |
| Sin membresía | Real | Bloquea acceso |
| Múltiples negocios | Real | Selector local sobre resultados RLS |
| Carga de datos | Mock o Supabase según entorno | Sin fallback silencioso |
| Error de datos | Real | Permite reintentar |
| Guardando formulario | Funcional | Botón deshabilitado y mensaje |
| Error de escritura | Funcional | Mensaje de dominio seguro |
| Toast de éxito | Funcional local | No persiste |
| Vacío de agenda/clientes | Funcional | Depende del conjunto cargado |
| Modal abierto/cerrado | Funcional local | Sheet accesible con botón cerrar |
| Conversaciones/IA | Mock | No representa estado externo |

## Qué funciona en modo mock

- Navegación completa.
- Listados y detalles de citas/clientes ficticios.
- Búsqueda local de clientes.
- Cambio de fecha dentro de cuatro fechas demo.
- Filtros de agenda por profesional.
- Crear citas en memoria.
- Crear bloqueos en memoria.
- Consultar una lista fija de horas mock.
- Cambiar estados de citas en memoria.
- Abrir conversaciones ficticias.
- Tomar/devolver conversaciones en memoria.
- Activar/desactivar automatizaciones en memoria.

El estado mock se pierde al recargar o reiniciar el módulo. No debe describirse
como persistente.

## Qué funciona en modo Supabase

- Auth y recuperación de contraseña.
- Membresía y selección de negocio.
- Lectura RLS de negocio, profesionales, servicios, asignaciones, horarios,
  bloqueos, clientes, citas y servicios de cita.
- Historial de cita bajo demanda.
- Crear cita mediante `create_appointment_with_services`.
- Consultar disponibilidad mediante `get_service_availability`.
- Crear bloqueo mediante `create_beauty_time_block`.
- Cambiar estado mediante `update_beauty_appointment_status`.
- Refresco de los datos operativos tras cada escritura.

Mensajes y automatizaciones siguen usando mocks incluso en modo Supabase.

## Controles que actualmente pueden engañar

Prioridad crítica:

- Recepcionista IA activa / IA en línea.
- Huecos: 4.
- Mensajes pendientes: 3.
- Tres horas disponibles.
- Hueco visual fijo en Agenda.
- Métricas de automatización.
- Toggles de automatización.
- Tomar conversación / Devolver a la IA.
- Botones Pendientes y Atendidas.
- Nuevo cliente.

Prioridad alta:

- Servicios, Profesionales, Horarios, Configuración y Perfil.
- Icono `…` en cada cita.
- Próxima reactivación en fichas Supabase.
- Historial/servicios habituales presentados como completos cuando solo
  contienen el rango cargado.

## Acciones inmediatas recomendadas

Sin implementar todavía su backend:

1. Ocultar cifras fijas de huecos, mensajes y disponibilidad.
2. Marcar Mensajes y Automatizaciones como “Demo” en mock y “Próximamente” en
   Supabase.
3. Deshabilitar “Nuevo cliente”.
4. Deshabilitar las entradas no implementadas de Más.
5. Eliminar el hueco fijo de Agenda en modo Supabase.
6. Sustituir `…` por un indicador de apertura si no existe menú contextual.
7. Etiquetar el historial de cliente como limitado al periodo.
8. Ocultar “Próxima reactivación” hasta disponer de reglas reales.
9. Para miembros staff, ocultar creación de bloqueos hasta conocer su
   `staff_member_id`.

## Diferencias de agenda y disponibilidad

| Concepto | Definición correcta | Soporte actual | Recomendación |
|---|---|---|---|
| Horario semanal habitual | Tramos recurrentes de trabajo por día | `staff_schedules` | Usar varios tramos para mañana/tarde |
| Descanso recurrente | Pausa semanal repetida | Puede modelarse como hueco entre dos `staff_schedules`, pero no conserva etiqueta “descanso” | Para MVP usar tramos separados; crear modelo recurrente solo si necesita nombre/configuración |
| Pausa puntual | Excepción de una fecha y profesional | `time_blocks` con `break` | Ya soportado |
| Ausencia puntual | Excepción por enfermedad/gestión | `time_blocks` con `absence` | Ya soportado |
| Vacaciones | Intervalo excepcional largo | `time_blocks` con `vacation` | Ya soportado; necesita UI por rango y gestión |
| Bloqueo personal | Excepción privada del profesional | `time_blocks` con `personal` | Ya soportado |
| Cierre global | Negocio no disponible | `time_blocks`, profesional nulo, `business_closed` | Ya soportado |

No debe usarse `staff_schedules` para vacaciones o cierres puntuales. Tampoco
debe usarse un `time_block` repetido manualmente para representar indefinidamente
el horario semanal.

## Propuesta de MVP funcional

El MVP operativo debería incluir:

1. Auth, negocio y roles.
2. Agenda dinámica por fecha y profesional.
3. Lectura de clientes, profesionales, servicios y horarios.
4. Crear cita para cliente existente.
5. Cambiar estados de cita.
6. Reprogramar cita.
7. Cancelar cita con motivo.
8. Crear y eliminar bloqueos.
9. Editar notas de cita.
10. Crear y editar clientes básicos.
11. Configurar servicios, profesionales y horarios semanales.
12. Ocultar Mensajes, IA, automatizaciones y estadísticas hasta que sean reales.

WhatsApp no es imprescindible para que este Manager sea un MVP funcional de
agenda.

## Orden recomendado de implementación

1. Sinceridad de interfaz: ocultar/deshabilitar controles engañosos.
2. Agenda dinámica y fecha real del negocio.
3. Cancelación y reprogramación transaccionales.
4. Eliminar/editar bloqueos.
5. Alta y edición básica de clientes.
6. Notas separadas de cita.
7. Gestión de horarios semanales y descansos.
8. Gestión de servicios y profesionales.
9. Fotografías/adjuntos.
10. Modelo persistente de conversaciones.
11. Evolution API y WhatsApp.
12. Gemini como capa conversacional.
13. Automatizaciones, consentimiento, límites y estadísticas.

## Dependencias funcionales

```text
Negocio + membresía
├── Profesionales
│   ├── Servicios habilitados
│   ├── Horarios semanales
│   └── Bloqueos/excepciones
├── Clientes
│   └── Consentimientos
└── Citas
    ├── Disponibilidad
    ├── Servicios snapshot
    ├── Estados/eventos
    └── Notas/adjuntos

Conversaciones WhatsApp
├── Clientes
├── Citas y disponibilidad
├── Evolution API
└── Gemini y herramientas internas

Automatizaciones
├── Citas/clientes
├── Consentimientos y bajas
├── Canal WhatsApp
└── Jobs, frecuencia y auditoría
```

## Cambios que requieren nuevas RPC, tablas o migraciones

### Solo nuevas RPC/políticas sobre tablas existentes

- Reprogramar cita.
- Cancelar cita.
- Editar notas limitadas de cita.
- Eliminar/desactivar bloqueo.
- Editar bloqueo.
- Crear/editar/desactivar cliente.
- Crear/editar/desactivar servicios.
- Crear/editar profesionales.
- Gestionar asignaciones `staff_services`.
- Gestionar `staff_schedules`.
- Actualizar configuración existente de `beauty_businesses`.

Cada operación debe ser específica, validar rol y negocio y generar evento
cuando corresponda.

### Probables migraciones nuevas

- Asociación inequívoca entre miembro staff y `staff_member_id`.
- Adjuntos/fotografías de citas y mensajes.
- Conversaciones, participantes, mensajes, estados, asignaciones y lecturas.
- Configuración de WhatsApp por negocio.
- Reglas de automatización y reactivación.
- Ejecuciones, entregas, errores y auditoría de automatizaciones.
- Consentimiento detallado, bajas y trazabilidad.
- Preferencias adicionales del negocio no presentes hoy.
- Descansos recurrentes, solo si los huecos entre tramos de
  `staff_schedules` no son suficientes.

## Dependencias externas

### Puede funcionar solo con Supabase

- Auth y roles.
- Agenda.
- Clientes.
- Profesionales.
- Servicios.
- Horarios.
- Bloqueos, vacaciones y cierres.
- Disponibilidad.
- Citas y estados.
- Reprogramación/cancelación.
- Historial y notas.
- Estadísticas puramente operativas.

### Requiere WhatsApp/Evolution API

- Recepción y envío real de mensajes.
- Estado real del canal.
- Adjuntos recibidos por WhatsApp.
- Confirmar/cambiar/cancelar desde WhatsApp.
- Entrega de recordatorios y reactivaciones.
- Handoff humano real y sincronización de conversaciones.
- Estados de entrega y errores del canal.

Evolution debe invocarse desde backend/Edge Functions, nunca directamente desde
el navegador.

### Requiere Gemini

- Comprensión de lenguaje natural.
- Identificación de intención y servicio.
- Preguntas por datos faltantes.
- Respuestas FAQ generativas controladas.
- Análisis conversacional de fotografías o referencias.
- Decisión de derivar a una persona.
- Orquestación de herramientas internas.

Gemini no debe decidir disponibilidad, precio, duración, permisos ni crear citas
sin pasar por las RPC/API validadas.

## Criterio de revisión

Antes de abrir nuevas fases debe decidirse si Mensajes y Automatizaciones
permanecen como demo explícita o se ocultan en modo Supabase. La recomendación
de esta auditoría es ocultarlas o deshabilitarlas, porque actualmente presentan
el mayor riesgo de generar confianza falsa.
