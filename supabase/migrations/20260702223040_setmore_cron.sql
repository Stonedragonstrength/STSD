-- Schedule the Setmore sync to run every 20 minutes via pg_cron + pg_net.
--
-- Auth for the cron -> Edge Function call comes from a Vault secret named
-- 'service_role_key' (referenced by name only — the actual value was set
-- once via `select vault.create_secret(...)` outside of any committed file,
-- so the key itself never lands in git history).

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Idempotent: drop any existing job with this name before (re)scheduling.
select cron.unschedule(jobid) from cron.job where jobname = 'sync-setmore-every-20-min';

select cron.schedule(
  'sync-setmore-every-20-min',
  '*/20 * * * *',
  $$
  select net.http_post(
    url := 'https://thhfslggjmtciavxrwwz.supabase.co/functions/v1/sync-setmore',
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
