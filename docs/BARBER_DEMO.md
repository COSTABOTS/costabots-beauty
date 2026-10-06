# Demo comercial de barbería

## Activación

La demo utiliza el repositorio mock existente cuando
`VITE_BEAUTY_DATA_MODE=mock`. No añade rutas ni un Manager paralelo y no se
activa en modo Supabase.

El estado inicial representa **NØR Barber Club** como `barber_shop`, por lo que
el Manager resuelve automáticamente el preset visual `barber`.

## Contenido

- tres profesionales: Alex, Dani y Mario;
- los seis servicios de la plantilla de barbería;
- diez clientes ficticios;
- citas relativas al día actual, mañana, otros días próximos y el día anterior;
- bloqueos de agenda;
- conversaciones mock de reserva confirmada, consulta de servicio y atención
  manual;
- automatizaciones locales de demostración.

Los cambios operativos del repositorio mock se guardan exclusivamente en
`costabots-beauty:mock-state:v1`. La versión interna del contenido se incrementó
para descartar de forma segura seeds antiguos de Luna Beauty Studio.

## Mensajes

Mensajes reutiliza los componentes existentes. La reserva mostrada coincide con
una cita de la agenda y la consulta de afeitado utiliza el catálogo real del
seed. Las solicitudes de cambio o de valoración profesional pasan a atención
humana; la demo no atribuye al asistente una reprogramación automática.

**Tomar conversación** y **Devolver a la IA** actualizan el estado visual local
durante la sesión. El compositor continúa deshabilitado porque la demo no envía
WhatsApp reales.

## Restablecimiento

En **Más → Configuración → Demostración**, la acción **Restablecer demo** borra
solo el estado mock guardado en el navegador y recarga la aplicación. El seed se
genera de nuevo respecto a la fecha actual. La acción no se renderiza en modo
Supabase.
