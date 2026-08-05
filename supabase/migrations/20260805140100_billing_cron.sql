-- Daily reconcile against Square. Webhooks get lost — Square gives up
-- retrying, a deploy lands mid-delivery, a rotated signature key rejects
-- everything until the secret catches up — and because payment state gates
-- next month's grant, stale state quietly becomes a wrong decision about
-- somebody's sessions. This drops a broken webhook from "wrong forever,
-- silently" to "a day late".
--
-- Runs before the prune job rather than alongside it, so a slow Square doesn't
-- share a minute with anything else. Auth mirrors the other crons: the
-- service-role key comes from the Vault secret 'service_role_key' by name only.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Idempotent reschedule.
select cron.unschedule(jobid) from cron.job where jobname = 'square-reconcile-daily';

select cron.schedule(
  'square-reconcile-daily',
  '41 3 * * *',
  $$
  select net.http_post(
    url := 'https://thhfslggjmtciavxrwwz.supabase.co/functions/v1/square-reconcile',
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
