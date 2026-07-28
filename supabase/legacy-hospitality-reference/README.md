# Referencia heredada no ejecutable

Esta carpeta conserva, únicamente como referencia histórica local, archivos que
existían en `supabase/migrations` antes de crear el historial oficial de
COSTABOTS Beauty.

Los archivos de `migrations/`:

- no forman parte del historial ejecutable de Beauty;
- no deben aplicarse al proyecto Supabase Beauty;
- no deben copiarse nuevamente a `supabase/migrations`;
- no fueron ejecutados durante la aplicación inicial de Beauty.

Se mantienen sin modificar para documentar su procedencia y facilitar una
auditoría posterior. Las funciones heredadas que permanecen en
`supabase/functions` tampoco forman parte de esta aplicación y no deben
desplegarse al proyecto Beauty.

