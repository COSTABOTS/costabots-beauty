# Restauración temporal de WhatsApp de Safar

> Documento operativo sanitizado. No contiene números completos, claves,
> tokens, códigos QR ni credenciales.

## Estado previo confirmado

Fecha de inventario: 30 de julio de 2026.

| Instancia | Estado en Evolution | Observación |
| --- | --- | --- |
| `Safar` | `Connected` | Conserva actualmente el número fijo de pruebas. |
| `beauty-demo` | `Connecting` | Instancia manual fuera del flujo automático de Beauty. No debe modificarse. |
| Beauty automática | `Disconnected` | Existe y no tiene QR generado. Supabase conserva la conexión en `awaiting_qr`. |

### Inventario de `Safar`

- Evolution: `2.3.7`.
- Client name / integración visible: `evolution_exchange`.
- Número conectado: termina en `176`.
- Contactos visibles: 3.
- Chats visibles: 5.
- Mensajes visibles: 254.
- Webhook: deshabilitado.
- URL del webhook: vacía.
- `webhookByEvents`: deshabilitado.
- Webhook Base64: deshabilitado.
- Eventos activos: ninguno.
- Ajustes no predeterminados visibles: ninguno identificado.

El inventario se obtuvo mediante inspección manual de solo lectura. No se
utilizaron `Restart`, `Disconnect`, `Delete` ni `Connect`, y no se modificó
ninguna configuración.

## Regla de desconexión

La instancia `Safar` nunca se elimina. Para liberar temporalmente el número se
utilizará exclusivamente la acción de cierre de sesión o desconexión de
WhatsApp que conserve:

- la instancia;
- su nombre;
- el webhook;
- los eventos;
- la integración;
- el resto de la configuración.

No se utilizarán `Delete`, `Restart` ni acciones de borrado.

## Comprobaciones inmediatamente posteriores

Antes de generar un QR para Beauty:

1. `Safar` continúa visible en Evolution.
2. Su estado es `Disconnected`, `Close` o equivalente.
3. El webhook y los eventos coinciden con el inventario previo.
4. `beauty-demo` continúa sin cambios.
5. La instancia Beauty automática continúa existiendo.

## Procedimiento de restauración

1. Desconectar la sesión de WhatsApp de Beauty sin eliminar la instancia.
2. Confirmar que sus conversaciones y mensajes permanecen en Supabase.
3. Abrir `Safar` en Evolution Manager.
4. Solicitar un QR nuevo para `Safar`.
5. Escanearlo manualmente desde el dispositivo que gestiona el número fijo.
6. Esperar a que `Safar` vuelva a `Connected`.
7. Confirmar que la integración visible vuelve a ser `evolution_exchange`.
8. Confirmar que el número termina en `176`.
9. Confirmar que el webhook continúa deshabilitado, sin URL ni eventos.
10. Confirmar que no aparecen ajustes no predeterminados inesperados.
11. Enviar un mensaje mínimo de prueba a Hospitality.
12. Confirmar que el evento llega únicamente al flujo original de Safar y no a
   COSTABOTS Beauty.

## Estado final esperado

- `Safar`: `Connected`, con su configuración original.
- `beauty-demo`: sin cambios.
- Beauty automática: `Disconnected`, conservando instancia, webhook,
  conversaciones y mensajes de prueba.
- COSTABOTS Beauty local: modo `mock`, signup público desactivado y WhatsApp
  desactivado.
- Vercel y Hospitality: sin cambios de configuración.
