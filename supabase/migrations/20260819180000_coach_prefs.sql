-- Coach push notification preferences, and the outbox that makes a digest
-- possible. See docs/superpowers/specs/2026-08-19-coach-push-notifications-design.md.
--
-- Why the coach needs more than the athlete's on/off: an athlete has one
-- coach, so a category is either wanted or not. The coach has a roster, and
-- twenty-eight athletes logging workouts is fifteen to twenty pushes a day.
-- Every category is therefore off / instant / digest, and the routine ones
-- default to digest so the feature survives its first week.

create table if not exists public.coach_prefs (
  coach_id       text primary key references public.coaches(id) on delete cascade,
  -- kind -> 'off' | 'instant' | 'digest'. jsonb rather than one column per
  -- category on purpose: there are seventeen of them and the set will grow, so
  -- a new category should be a code change, not a migration plus a rows.js
  -- mapping. Anything absent falls back to the defaults in
  -- functions/_shared/coach-notify.ts, which is the single source for them.
  notify_modes   jsonb not null default '{}'::jsonb,
  -- Wall clock, in the coach's own zone, same as athlete_prefs. Text rather
  -- than `time` to match that table and the "HH:MM" strings the app stores.
  tz             text not null default 'UTC',
  digest_at      text not null default '19:00',
  -- The local date the digest last fired, so a 15-minute cron cannot send the
  -- same summary twice in a day. Server-written.
  last_digest_on date,
  -- Quiet hours. May wrap past midnight. NOTE these DEFER rather than drop:
  -- see coach_notice_queue.deferred.
  quiet_on       boolean not null default true,
  quiet_from     text not null default '21:00',
  quiet_to       text not null default '07:00',
  updated_at     timestamptz not null default now()
);

alter table public.coach_prefs enable row level security;

create policy "coach manages own prefs" on public.coach_prefs
  for all
  using (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())))
  with check (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())));

-- The outbox. Not a record of anything: rows are deleted as they are sent.
--
-- Two kinds of row live here. A `digest` category lands here and waits for the
-- coach's daily summary. An `instant` category that arrives inside quiet hours
-- lands here with deferred = true and goes out the moment quiet hours end.
--
-- Deferring rather than dropping is the difference from the athlete side. An
-- athlete losing a bulletin at 2am costs nothing; a coach losing a failed card
-- charge overnight costs money, and Square is live.
create table if not exists public.coach_notice_queue (
  id         bigint generated always as identity primary key,
  coach_id   text not null references public.coaches(id) on delete cascade,
  kind       text not null,
  -- Composed on the server, always. An athlete never supplies these strings:
  -- see the header of functions/notify-coach/index.ts for why that rule
  -- exists and what breaks if it is relaxed.
  title      text not null,
  body       text not null,
  url        text,
  deferred   boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists coach_notice_queue_coach_idx
  on public.coach_notice_queue (coach_id, created_at);

alter table public.coach_notice_queue enable row level security;

-- Read-only to the coach: useful for showing "what is waiting" in the app, and
-- there is no reason for a client to write here. The Edge Functions use the
-- service role.
create policy "coach reads own queue" on public.coach_notice_queue
  for select
  using (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())));
