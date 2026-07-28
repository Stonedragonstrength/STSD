-- Per-athlete app preferences: what they want pushed, and how much of the
-- game layer they want to see.
--
-- These deliberately live in their own table rather than on `progress`:
--   * the send-push and workout-reminder Edge Functions read them on every
--     send, and a narrow table is far cheaper to scan than the progress blob;
--   * `last_reminder_on` is written by the server, and progress rows are
--     overwritten wholesale by the athlete's app on every save.
-- Athletes own their row; the functions read it with the service role.

create table if not exists public.athlete_prefs (
  athlete_id       text primary key,
  -- Push categories. Off means the server skips that athlete for that kind.
  notify_bulletins  boolean not null default true,
  notify_messages   boolean not null default true,
  notify_formchecks boolean not null default true,
  -- Daily "time to train" nudge, in the athlete's own timezone.
  reminder_on      boolean not null default false,
  reminder_time    text    not null default '17:00',
  tz               text    not null default 'UTC',
  -- Quiet hours. Applies to coach-sent pushes; may wrap past midnight.
  quiet_on         boolean not null default false,
  quiet_from       text    not null default '21:00',
  quiet_to         text    not null default '07:00',
  -- App surface prefs.
  simple_mode      boolean not null default false,
  hide_weight      boolean not null default false,
  -- Server bookkeeping: the local date the reminder last fired, so a
  -- 15-minute cron can never send the same nudge twice in a day.
  last_reminder_on date,
  updated_at       timestamptz not null default now()
);

alter table public.athlete_prefs enable row level security;

create policy "athlete manages own prefs" on public.athlete_prefs
  for all
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())))
  with check (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));
