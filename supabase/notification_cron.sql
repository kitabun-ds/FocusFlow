-- Run after applying migrations/202609300001_notifications.sql and enabling
-- pg_cron, pg_net, and Supabase Vault for the project.
-- Store these values in Vault before scheduling the job:
--   name=focusflow_project_url:        https://<project-ref>.supabase.co
--   name=focusflow_notification_key:   <the project's publishable/anon API key>
--   name=focusflow_notification_cron:  same random secret as NOTIFICATION_CRON_SECRET
-- Do not put VAPID private keys or service-role keys in this SQL file.

select cron.unschedule(jobid)
  from cron.job
 where jobname = 'focusflow-notification-scheduler';

select cron.schedule(
    'focusflow-notification-scheduler',
    '*/5 * * * *',
    $$
    select net.http_post(
        url := (
            select decrypted_secret
              from vault.decrypted_secrets
             where name = 'focusflow_project_url'
        ) || '/functions/v1/send-notifications',
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'apikey', (
                select decrypted_secret
                  from vault.decrypted_secrets
                 where name = 'focusflow_notification_key'
            ),
            'x-notification-cron-secret', (
                select decrypted_secret
                  from vault.decrypted_secrets
                 where name = 'focusflow_notification_cron'
            )
        ),
        body := '{}'::jsonb
    ) as request_id;
    $$
);
