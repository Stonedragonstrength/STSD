-- Fires coach-digest every 15 minutes. Same shape as the four crons already
-- running: the function decides who is due, because the coach picks a wall
-- clock time in their own timezone and the only way to honour that globally is
-- to check often and let last_digest_on guarantee one summary per local day.
--
-- The same pass also flushes notifications that were deferred by quiet hours,
-- which is why it cannot simply run once a day at the digest hour.
--
-- Auth mirrors workout-reminder: the service-role key comes from the Vault
-- secret 'service_role_key' by name only.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Idempotent reschedule.
select cron.unschedule(jobid) from cron.job where jobname = 'coach-digest-15min';

select cron.schedule(
  'coach-digest-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://thhfslggjmtciavxrwwz.supabase.co/functions/v1/coach-digest',
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
