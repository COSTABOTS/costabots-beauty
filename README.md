# COSTABOTS Beauty

Base técnica independiente y todavía provisional para el nuevo producto COSTABOTS Beauty.

## Estado

La fase actual es exclusivamente de aislamiento técnico. La interfaz y el dominio Hospitality permanecen como referencia heredada, pero las conexiones a Supabase Hospitality, Make, Vercel y Google Sheets están neutralizadas por defecto.

## Arranque local

1. Copia `.env.example` a `.env.local`.
2. Usa exclusivamente un proyecto Supabase independiente de Beauty.
3. Mantén `VITE_ENABLE_LEGACY_SHEETS=false` y `VITE_ENABLE_LEGACY_WEBHOOKS=false`.
4. Ejecuta `npm install` y `npm run dev`.

Sin las variables obligatorias la aplicación falla deliberadamente con un mensaje de seguridad. Nunca copies el `.env` de COSTABOTS Manager.

## Restricciones

- No ejecutar migraciones heredadas.
- No desplegar Edge Functions heredadas.
- No usar `supabase link` ni Vercel hasta crear proyectos Beauty independientes.
- No habilitar Google Sheets o webhooks heredados salvo una auditoría posterior explícita.

Consulta `docs/TECHNICAL_ISOLATION.md` para el inventario y decisiones de esta fase.
