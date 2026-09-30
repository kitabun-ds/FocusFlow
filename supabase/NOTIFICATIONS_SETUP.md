# FocusFlow Web Push deployment

1. Apply `migrations/202609300001_notifications.sql` to the Supabase project (or use the full `schema.sql` on a new project).
2. Generate one VAPID key pair (for example, with `npx web-push generate-vapid-keys`). Keep the private key out of the repository and browser code. Configure these server secrets:
   - Flask: `NOTIFICATION_VAPID_PUBLIC_KEY` (the public URL-safe base64 key only).
   - Supabase Edge Function: `NOTIFICATION_VAPID_PUBLIC_KEY`, `NOTIFICATION_VAPID_PRIVATE_KEY`, `NOTIFICATION_CRON_SECRET`, and optionally `NOTIFICATION_VAPID_SUBJECT`.
   - Use the same VAPID public key in Flask and the Edge Function. Use the same random cron secret in the Edge Function and Vault.
3. Store the Supabase project URL, publishable/anon API key, and cron secret in Supabase Vault using the names shown in `notification_cron.sql`. The service-role key remains an Edge Function secret and Flask server environment variable; it is never sent to the browser.
4. Deploy `send-notifications` with the repository's Supabase CLI. `config.toml` disables gateway JWT verification only for this function; the function checks the separate cron secret on every request.
5. Enable `pg_cron`, `pg_net`, and Vault if the project has not enabled them, then run `notification_cron.sql`. Check Cron run history and Edge Function logs after deployment.
6. Set `NOTIFICATION_VAPID_PUBLIC_KEY` in Flask, serve the app over HTTPS, and sign in. In Settings, grant browser permission and enable the desired categories on each device.

The Edge Function polls every five minutes. It reads current goals and date-keyed Track history from `focusflow_user_data`, uses the saved IANA timezone, and records a unique user/type/event claim before sending. A database-backed eight-hour user cooldown and quote rotation protect overlapping Cron runs. Push providers can still reject messages; expired 404/410 subscriptions are removed automatically.

For a fresh project, create/update the Vault entries in the SQL Editor with `vault.create_secret(value, name)` using the three exact names above. Then run the scheduler SQL. Set the Edge Function secrets with `supabase secrets set NOTIFICATION_VAPID_PUBLIC_KEY='…' NOTIFICATION_VAPID_PRIVATE_KEY='…' NOTIFICATION_CRON_SECRET='…' NOTIFICATION_VAPID_SUBJECT='mailto:<your-support-address>'`, and set only the public VAPID key in Flask.
