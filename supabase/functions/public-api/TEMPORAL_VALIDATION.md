# Validación temporal de reservas Hospitality

La API pública Hospitality usa `Europe/Madrid` de forma explícita al evaluar
una fecha y hora de reserva. La validación se ejecuta en el servidor antes de
crear cualquier fila en `RESERVAS` y exige una antelación mínima centralizada
de `MIN_BOOKING_LEAD_MINUTES = 30`.

- Un slot que no cumple los 30 minutos de antelación devuelve `409` con el
  código `RESERVATION_TIME_PASSED`.
- `availability/by-hour` no devuelve los slots ya vencidos para el día local
  actual.
- La lógica no modifica aforo, mesas, reservas existentes, Manager ni el flujo
  de reservas balinesas.

La cobertura automatizada está en `lib/reservations_temporal_test.ts` e incluye
fechas anteriores y futuras, la hora actual, cambio de medianoche local y los
dos cambios anuales de horario de Madrid.

Verificación:

```sh
deno test supabase/functions/public-api/lib/reservations_temporal_test.ts
deno check supabase/functions/public-api/routes/reservationCreate.ts supabase/functions/public-api/routes/availabilityByHour.ts
```
