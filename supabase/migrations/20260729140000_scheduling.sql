-- In-app scheduling: the coach publishes recurring availability, the app
-- generates bookable slots from it, and athletes book one directly. This
-- replaces the Setmore round trip (coach posts a slot by hand -> athlete
-- claims -> coach re-books it in Setmore). The old `open_slots` array and the
-- `setmore_events` mirror both stay put: this runs alongside them so nothing
-- has to be switched off on a particular day.

-- ---------- availability ----------
-- One jsonb blob on the coach. Wall-clock times plus the zone they are written
-- in, never instants, because "Mondays at 6am" has to survive a DST change.
--   {
--     tz: "America/New_York",
--     sessionMins: 60, bufferMins: 0,
--     leadHours: 12,        -- how close to a start an athlete may still book
--     horizonDays: 21,      -- how far ahead slots are offered
--     weekly: { "1": [{ start: "06:00", end: "11:00" }], ... },  -- 0=Sun
--     blackouts: ["2026-08-03"],                 -- whole days off
--     extra: [{ date: "2026-08-09", start: "08:00", end: "10:00" }]
--   }
alter table public.coaches
  add column if not exists availability jsonb not null default '{}'::jsonb;

-- ---------- bookings ----------
create table if not exists public.bookings (
  id           text primary key,
  coach_id     text not null references public.coaches(id) on delete cascade,
  athlete_id   text not null references public.athletes(id) on delete cascade,
  start_at     timestamptz not null,
  end_at       timestamptz not null,
  -- 'booked' rows hold the slot; cancelling releases it (see the index below).
  status       text not null default 'booked' check (status in ('booked', 'cancelled')),
  note         text,
  -- Set by whichever side created it, for the coach's own records.
  created_by   text not null default 'athlete' check (created_by in ('coach', 'athlete')),
  -- The event this booking owns on the coach's Google Calendar, if connected.
  google_event_id text,
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz
);

-- FIRST ONE WINS. Two athletes tapping the same slot at the same moment both
-- pass any "is it free?" read; this index is what makes the second insert fail
-- (23505) instead of double-booking. Partial, so a cancelled booking frees the
-- time again. Do not drop it in favour of an application-level check.
create unique index if not exists bookings_slot_uniq
  on public.bookings (coach_id, start_at) where status = 'booked';

create index if not exists bookings_coach_start_idx
  on public.bookings (coach_id, start_at);
create index if not exists bookings_athlete_start_idx
  on public.bookings (athlete_id, start_at);

alter table public.bookings enable row level security;

-- Athletes see and make their own bookings, and may cancel them. They may not
-- see anyone else's: an athlete learns a time is taken from the slot list the
-- app builds, not by reading the row.
create policy "athlete reads own bookings" on public.bookings
  for select to authenticated
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));

create policy "athlete books for self" on public.bookings
  for insert to authenticated
  with check (
    created_by = 'athlete'
    and status = 'booked'
    and athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()))
  );

create policy "athlete cancels own bookings" on public.bookings
  for update to authenticated
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())))
  with check (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));

create policy "coach manages own bookings" on public.bookings
  for all to authenticated
  using (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())))
  with check (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())));

-- An athlete's update policy exists so they can cancel. Cancelling must not
-- double as moving the appointment or reassigning it, so everything except
-- status/cancelled_at/note is frozen for them. The coach is left alone: moving
-- a booking is a thing a coach legitimately does.
create or replace function public.bookings_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_coach boolean;
begin
  select exists (
    select 1 from public.coaches
    where id = old.coach_id and auth_user_id = (select auth.uid())
  ) into is_coach;
  if is_coach then
    return new;
  end if;
  if new.id         is distinct from old.id
  or new.coach_id   is distinct from old.coach_id
  or new.athlete_id is distinct from old.athlete_id
  or new.start_at   is distinct from old.start_at
  or new.end_at     is distinct from old.end_at
  or new.created_by is distinct from old.created_by
  or new.created_at is distinct from old.created_at then
    raise exception 'bookings: an athlete may only cancel, not reschedule';
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_guard on public.bookings;
create trigger bookings_guard
  before update on public.bookings
  for each row execute function public.bookings_guard_update();

-- ---------- slot listing for athletes ----------
-- An athlete must know which times are already taken without being able to
-- read who took them. This returns start times only, for one window, and is
-- the only way the athlete side learns about other people's bookings.
create or replace function public.booked_starts_for_athlete(from_at timestamptz, to_at timestamptz)
returns table (start_at timestamptz, end_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select b.start_at, b.end_at
  from public.bookings b
  where b.status = 'booked'
    and b.start_at >= from_at
    and b.start_at <  to_at
    and b.coach_id in (
      select a.coach_id from public.athletes a where a.auth_user_id = (select auth.uid())
    );
$$;

revoke all on function public.booked_starts_for_athlete(timestamptz, timestamptz) from public;
grant execute on function public.booked_starts_for_athlete(timestamptz, timestamptz) to authenticated;

-- The coach's availability is coach-owned data the athlete has to read to see
-- any slots at all. Same shape of answer as the invite-code lookup: one row,
-- fetched through a definer function rather than by opening up `coaches`.
create or replace function public.availability_for_athlete()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(c.availability, '{}'::jsonb)
  from public.coaches c
  where c.id in (
    select a.coach_id from public.athletes a where a.auth_user_id = (select auth.uid())
  )
  limit 1;
$$;

revoke all on function public.availability_for_athlete() from public;
grant execute on function public.availability_for_athlete() to authenticated;

-- ---------- Google Calendar connection ----------
-- One row per coach. The refresh token is long-lived and must never reach the
-- browser, so this table is readable by nobody: every policy is omitted on
-- purpose and only the Edge Function's service-role key touches it. RLS is on
-- with no policies, which denies everything to anon and authenticated.
create table if not exists public.google_calendar (
  coach_id      text primary key references public.coaches(id) on delete cascade,
  refresh_token text not null,
  calendar_id   text not null default 'primary',
  account_email text,
  connected_at  timestamptz not null default now(),
  last_error    text
);

alter table public.google_calendar enable row level security;

-- What the browser is allowed to know: whether a connection exists and which
-- account it points at. Never the token.
create or replace function public.google_calendar_status()
returns table (connected boolean, account_email text, calendar_id text, last_error text)
language sql
security definer
set search_path = public
as $$
  select true, g.account_email, g.calendar_id, g.last_error
  from public.google_calendar g
  where g.coach_id in (select id from public.coaches where auth_user_id = (select auth.uid()));
$$;

revoke all on function public.google_calendar_status() from public;
grant execute on function public.google_calendar_status() to authenticated;
