-- Fires the workout-reminder Edge Function every 15 minutes. The function
-- itself decides who is due: athletes pick a wall-clock time in their own
-- timezone, so the only way to honour that globally is to check often and let
-- last_reminder_on guarantee one nudge per athlete per local day.
--
-- Auth mirrors prune-form-checks: the service-role key comes from the Vault
-- secret 'service_role_key' by name only.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Idempotent reschedule.
select cron.unschedule(jobid) from cron.job where jobname = 'workout-reminder-15min';

select cron.schedule(
  'workout-reminder-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://thhfslggjmtciavxrwwz.supabase.co/functions/v1/workout-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
  $$
);
