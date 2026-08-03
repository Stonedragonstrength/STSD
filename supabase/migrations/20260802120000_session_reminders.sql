-- "Your session is at 4:00" — a push tied to a real booking, which is a
-- different thing from the daily "time to train" nudge already in here. That
-- one fires at a wall-clock time the athlete picked and is skipped if they
-- already trained; this one fires ahead of an appointment they agreed to.

alter table public.athlete_prefs
  -- Default ON: an athlete who has never opened Profile should still be told
  -- when their session is, the same way they still hear from their coach.
  add column if not exists notify_sessions   boolean not null default true,
  -- How long before the start. Per athlete, because "two hours" is useless to
  -- someone who trains at 6am and lives ten minutes away.
  add column if not exists session_lead_mins integer not null default 120;

-- Per-BOOKING bookkeeping, not per-day: an athlete can have two sessions in a
-- day and must hear about both, which last_reminder_on could never express.
-- Also means a reminder survives the cron missing a tick — the row is still
-- unsent, so the next run catches it instead of skipping the session.
alter table public.bookings
  add column if not exists reminder_sent_at timestamptz;

-- The sender scans "booked, starting soon, not yet reminded", so that is the
-- index. Partial on the null, which is the only state it ever looks for.
create index if not exists bookings_reminder_due_idx
  on public.bookings (start_at)
  where status = 'booked' and reminder_sent_at is null;

-- Fires every 15 minutes. The function works out who is due: leads are
-- per-athlete, so there is no single clock tick to hang this off. Auth mirrors
-- the other jobs — the service-role key comes from the Vault secret by name.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'session-reminder-15min';

select cron.schedule(
  'session-reminder-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://thhfslggjmtciavxrwwz.supabase.co/functions/v1/session-reminder',
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
