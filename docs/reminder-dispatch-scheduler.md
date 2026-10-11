# Reminder dispatcher scheduler (not activated)

The dispatcher is intentionally invoked only by an internal cron secret. Its
default `REMINDERS_DRY_RUN` behaviour is observation-only; it never contacts
Evolution unless the value is explicitly `false`.

The linked Supabase project currently has neither `pg_cron` nor `pg_net`
enabled, so no scheduler has been created.

Once both extensions are enabled and the deployment is approved, create a
Vault secret named `reminders_dispatch_cron_secret` containing the dedicated
`REMINDERS_CRON_SECRET` value, then schedule this exact job:

```sql
select cron.schedule(
  'beauty-appointment-reminders-dispatch-5m',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://orixkcaufgaxaebwpnux.supabase.co/functions/v1/beauty-appointment-reminders-dispatch',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-reminder-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'reminders_dispatch_cron_secret'
        )
      ),
      body := '{"batchSize":10}'::jsonb
    );
  $$
);
```

Disable immediately with:

```sql
select cron.unschedule('beauty-appointment-reminders-dispatch-5m');
```

Do not store the cron secret in a SQL literal or application setting. The
function rejects requests without the dedicated header, even when JWT
verification is disabled for scheduler compatibility.
