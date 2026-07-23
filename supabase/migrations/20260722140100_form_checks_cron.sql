-- Auto-delete form-check clips 30 days after upload (athletes are told this up
-- front). A daily cron hits the prune-form-checks Edge Function, which lists the
-- bucket and removes stale objects via the Storage API (proper blob deletion,
-- not just an orphaning row delete). Auth mirrors sync-setmore: the service-role
-- key comes from the Vault secret 'service_role_key' by name only.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Idempotent reschedule.
select cron.unschedule(jobid) from cron.job where jobname = 'prune-form-checks-daily';

select cron.schedule(
  'prune-form-checks-daily',
  '17 4 * * *',
  $$
  select net.http_post(
    url := 'https://thhfslggjmtciavxrwwz.supabase.co/functions/v1/prune-form-checks',
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
