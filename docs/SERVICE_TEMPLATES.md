# Plantillas rápidas de servicios

## Objetivo

Las plantillas reducen el trabajo inicial de microcentros. Ningún servicio se
crea al elegir una plantilla: primero se revisa, edita y selecciona cada fila,
y la importación solo comienza al pulsar **Importar servicios**.

## Catálogos incluidos

- **Salón de uñas:** 10 sugerencias de manicura, gel, acrílico, pedicura y
  decoración.
- **Peluquería:** 11 sugerencias de corte, peinado, color, mechas, balayage,
  tratamientos y recogidos.
- **Centro de estética:** 10 sugerencias de facial, cejas, pestañas, masaje,
  depilación y corporal.
- **Otro:** no importa ni selecciona servicios automáticamente. Permite usar
  cualquiera de los tres catálogos como punto de partida.

El `business_type` destaca la plantilla correspondiente durante el onboarding.
La selección sigue necesitando confirmación humana.

## Estructura y valores sugeridos

Cada sugerencia contiene un identificador local, nombre, categoría orientativa,
duración y precio. La interfaz solo expone nombre, duración y precio en esta
fase. Las duraciones permitidas son 15, 30, 45, 60, 75, 90, 120, 150 y 180
minutos.

Los importes son sugerencias editables en EUR, no precios oficiales ni medias
de mercado. La RPC ignora cualquier moneda enviada por el navegador y utiliza
siempre la moneda configurada en el negocio.

## Flujo de revisión

1. Elegir o cambiar de plantilla.
2. Seleccionar o desmarcar servicios.
3. Editar nombre, duración y precio.
4. Añadir filas manuales si hace falta.
5. Resolver los duplicados detectados.
6. Importar en una sola operación.

El panel muestra selección total, restauración del catálogo, estado de carga,
errores comprensibles y el resumen de creados, omitidos y sustituidos.

## Duplicados

Los nombres se normalizan ignorando mayúsculas, espacios y tildes comunes. La
opción predeterminada es **Omitir duplicado**. También se puede:

- sustituir expresamente duración y precio del servicio activo existente;
- editar el nombre e importarlo como uno nuevo.

Nunca se actualiza un servicio existente sin una elección explícita. La RPC
usa un advisory lock transaccional por negocio para evitar carreras.

## Importación y asignación

`import_beauty_services` acepta como máximo 50 filas y 64 KiB de JSON. Valida
sesión, rol owner/admin, negocio activo, nombre, duración, precio y acción de
duplicado. Usa `SECURITY DEFINER`, `search_path` fijo y concede ejecución solo
a `authenticated`.

Cuando hay exactamente un profesional activo, la operación crea o reactiva la
asignación de cada servicio importado a esa persona. Con cero o varias personas
no se elige a nadie de forma arbitraria.

## Mock y Supabase

- **Mock:** aplica las mismas validaciones y reglas de duplicados, actualiza
  servicios y asignaciones en memoria y persiste mediante
  `costabots-beauty:mock-state:v1`.
- **Supabase:** ejecuta la RPC transaccional y refresca servicios,
  profesionales y asignaciones. No existe fallback a mock.

El onboarding avanza cuando los datos recargados contienen al menos un servicio
activo y una asignación profesional-servicio activa.

## Gemini más adelante

La futura importación con Gemini reutilizará el mismo panel de revisión y el
mismo contrato de importación. Gemini propondrá filas desde imágenes o PDF,
pero nunca escribirá directamente ni evitará las validaciones de la RPC.

## Limitaciones conocidas

- Las categorías sugeridas todavía no se guardan en la tabla de servicios.
- No se mezclan varias plantillas automáticamente.
- Con varias personas activas, las asignaciones deben realizarse después de
  forma explícita.
- No hay importación desde imagen/PDF, WhatsApp, Realtime ni precios de mercado.
- Antes de activar esta función en producción queda pendiente una prueba con un
  segundo usuario autenticado perteneciente a un negocio distinto: su intento
  de importar en el primer negocio debe ser rechazado por membership y RLS. No
  debe crearse ningún servicio ni asignación durante ese intento.
