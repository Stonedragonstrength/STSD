-- Athlete-side changes to a booked session: cancelling with notice, and moving
-- to another open slot.
--
-- Cancelling already shipped and was completely unguarded — the athlete UI has
-- drawn a Cancel button on every upcoming session since the scheduling
-- migration, with no notice window, no record, and nothing told to the coach.
-- So most of this is a fence around live behaviour rather than a new power.
--
-- The shape, and why it is two paths rather than one:
--
--   OUTSIDE the notice window an athlete can already cancel and re-book in two
--   taps, so asking the coach to approve a move would be a gate they can walk
--   around. What they cannot do in two taps is make it SAFE: cancel-then-book
--   releases the old slot before the new one is held, and if somebody takes the
--   new time in between they are left with nothing. `athlete_move_booking`
--   below is that pair done atomically, and it is the whole reason it exists.
--
--   INSIDE the window nothing moves without the coach. Both cancelling and
--   moving become a `booking_requests` row they approve or deny. Nothing about
--   the booking changes until they do.
--
-- The window itself is `cancelHours` on the coach's `availability` jsonb —
-- twin of the existing `leadHours`, which is how close to a start an athlete
-- may still BOOK. No DDL for it, and the athlete already receives that blob.

-- ---------- shared helpers ----------

-- How close to the start an athlete may still cancel unaided. Absent means 24:
-- a coach who has never opened the editor gets the safe default rather than an
-- open door, and 0 is a real answer meaning "no notice required".
create or replace function public.coach_cancel_hours(p_coach_id text)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((c.availability->>'cancelHours')::numeric, 24)
  from public.coaches c where c.id = p_coach_id;
$$;

-- Does this exact window sit inside the hours the coach publishes?
--
-- The browser only ever offers times `generateSlots()` produced, so in normal
-- use this always passes. It exists for the abnormal use: an RPC argument is a
-- claim, and without this an athlete could post any instant they liked and land
-- a 3am session in the coach's calendar. It re-implements the generator's rules
-- rather than its loop — same windows, same blackouts, same grid alignment —
-- so keep the two in step (app.js generateSlots).
create or replace function public.availability_allows(av jsonb, at_start timestamptz, at_end timestamptz)
returns boolean
language plpgsql
stable
as $$
declare
  tz    text := coalesce(nullif(av->>'tz', ''), 'UTC');
  mins  int  := coalesce((av->>'sessionMins')::int, 60);
  step  int  := mins + coalesce((av->>'bufferMins')::int, 0);
  loc     timestamp;
  d       date;
  t_start time;
  t_end   time;
  win     jsonb;
begin
  if at_start is null or at_end is null or av is null then return false; end if;
  -- Exactly the published length. Anything else was hand-made, not offered.
  if at_end <> at_start + make_interval(mins => mins) then return false; end if;

  loc     := at_start at time zone tz;
  d       := loc::date;
  t_start := loc::time;
  t_end   := (at_end at time zone tz)::time;
  -- A session crossing local midnight cannot be expressed as start/end wall
  -- clock on one day, and the generator never emits one.
  if t_end <= t_start then return false; end if;

  if jsonb_exists(coalesce(av->'blackouts', '[]'::jsonb), d::text) then return false; end if;

  -- One-off `extra` hours are additive: a date listed there is bookable even on
  -- a weekday with no recurring window, so it is checked first and alone.
  for win in select * from jsonb_array_elements(coalesce(av->'extra', '[]'::jsonb)) loop
    if win->>'date' = d::text
       and (win->>'start')::time <= t_start
       and (win->>'end')::time   >= t_end
       and mod(extract(epoch from (t_start - (win->>'start')::time))::int, step * 60) = 0 then
      return true;
    end if;
  end loop;

  -- 0 = Sunday, matching the weekly keys the editor writes.
  for win in select * from jsonb_array_elements(
      coalesce(av->'weekly'->(extract(dow from loc)::int::text), '[]'::jsonb)) loop
    if (win->>'start')::time <= t_start
       and (win->>'end')::time >= t_end
       and mod(extract(epoch from (t_start - (win->>'start')::time))::int, step * 60) = 0 then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- ---------- the notice window, enforced ----------
-- Extends the existing guard (20260729140000_scheduling.sql). The frozen-column
-- rule is unchanged and reproduced verbatim; the cutoff is new.
--
-- This is the enforcement point that actually matters, and the reason it is in
-- the database rather than only in `renderAthleteBooking()`: an installed PWA
-- serves the previous build from cache, and every athlete still on it has the
-- old unguarded Cancel button wired straight to an UPDATE that RLS permits.
-- The UI is a courtesy; this is the rule. Old clients get their generic
-- "Couldn't cancel that" toast, which is confusing but safe, and they pick up
-- the new build on the next online open.
create or replace function public.bookings_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_coach boolean;
  cutoff_h numeric;
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

  if new.status = 'cancelled' and old.status = 'booked' then
    cutoff_h := public.coach_cancel_hours(old.coach_id);
    if cutoff_h > 0 and now() >= old.start_at - make_interval(secs => cutoff_h * 3600) then
      raise exception 'bookings: too close to the session to cancel without asking';
    end if;
  end if;
  return new;
end;
$$;

-- ---------- change requests ----------
-- Only ever written through the definer RPCs below, which is why there is no
-- athlete INSERT policy: the notice-window check and the "is this a real slot"
-- check live in those functions, and a direct insert would skip both.
create table if not exists public.booking_requests (
  id           text primary key,
  booking_id   text not null references public.bookings(id) on delete cascade,
  coach_id     text not null references public.coaches(id)  on delete cascade,
  athlete_id   text not null references public.athletes(id) on delete cascade,
  kind         text not null check (kind in ('cancel', 'move')),
  -- Null for 'cancel'. For 'move', the slot they are asking for — held by
  -- nobody until the coach approves, deliberately: a pending request that
  -- reserved a time would let one athlete freeze the coach's calendar.
  new_start_at timestamptz,
  new_end_at   timestamptz,
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  note         text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

-- One open request per booking. Partial for the same reason bookings_slot_uniq
-- is: resolved rows are history and must not block a second ask.
create unique index if not exists booking_requests_one_open
  on public.booking_requests (booking_id) where status = 'pending';

create index if not exists booking_requests_coach_idx
  on public.booking_requests (coach_id, created_at desc) where status = 'pending';

alter table public.booking_requests enable row level security;

create policy "athlete reads own booking requests" on public.booking_requests
  for select to authenticated
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));

create policy "coach manages own booking requests" on public.booking_requests
  for all to authenticated
  using (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())))
  with check (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())));

-- ---------- moving a booking, atomically ----------
-- Insert the new row FIRST, then release the old one. That order is the whole
-- point: if the new time was taken in the seconds since the slot list was
-- drawn, the unique index raises, the block returns 'taken', and the athlete
-- still has the session they started with.
--
-- `google_event_id` rides across to the new row and is nulled on the old one,
-- so the single `googleCall("push")` the client fires afterwards PATCHes the
-- existing calendar event to its new time instead of orphaning one and
-- creating another. `series_id` rides across too: a weekly session moved one
-- week is still that athlete's weekly session, and "cancel the rest" should
-- still find it.
create or replace function public.athlete_move_booking(
  p_booking_id text, p_new_id text, p_new_start timestamptz, p_new_end timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk   public.bookings%rowtype;
  av   jsonb;
  can  boolean;
  cutoff_h numeric;
begin
  select * into bk from public.bookings b
   where b.id = p_booking_id
     and b.athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if bk.status <> 'booked' then return jsonb_build_object('ok', false, 'reason', 'not_booked'); end if;
  if coalesce(nullif(p_new_id, ''), '') = '' then return jsonb_build_object('ok', false, 'reason', 'bad_id'); end if;

  -- Moving is booking plus cancelling, so it needs the permission for both.
  select a.can_book into can from public.athletes a where a.id = bk.athlete_id;
  if not coalesce(can, false) then return jsonb_build_object('ok', false, 'reason', 'not_allowed'); end if;

  cutoff_h := public.coach_cancel_hours(bk.coach_id);
  if cutoff_h > 0 and now() >= bk.start_at - make_interval(secs => cutoff_h * 3600) then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;

  select c.availability into av from public.coaches c where c.id = bk.coach_id;
  if not public.availability_allows(av, p_new_start, p_new_end) then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;
  -- The same lead time that governs a fresh booking governs the destination.
  if now() >= p_new_start - make_interval(secs => coalesce((av->>'leadHours')::numeric, 0) * 3600) then
    return jsonb_build_object('ok', false, 'reason', 'too_soon');
  end if;

  begin
    insert into public.bookings
      (id, coach_id, athlete_id, start_at, end_at, status, note, created_by, google_event_id, series_id)
    values
      (p_new_id, bk.coach_id, bk.athlete_id, p_new_start, p_new_end, 'booked', bk.note, 'athlete',
       bk.google_event_id, bk.series_id);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), google_event_id = null
   where id = bk.id;

  return jsonb_build_object('ok', true, 'id', p_new_id, 'oldId', bk.id);
end;
$$;

-- ---------- asking, when it is too late to act ----------
create or replace function public.request_booking_change(
  p_id text, p_booking_id text, p_kind text,
  p_new_start timestamptz, p_new_end timestamptz, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  bk public.bookings%rowtype;
  av jsonb;
  cutoff_h numeric;
begin
  if p_kind not in ('cancel', 'move') then return jsonb_build_object('ok', false, 'reason', 'bad_kind'); end if;

  select * into bk from public.bookings b
   where b.id = p_booking_id
     and b.athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if bk.status <> 'booked' then return jsonb_build_object('ok', false, 'reason', 'not_booked'); end if;

  -- Outside the window there is nothing to ask for: they can do it themselves,
  -- and a request would just park a decision on the coach that the app already
  -- decided. Tell the client to use the direct path.
  cutoff_h := public.coach_cancel_hours(bk.coach_id);
  if cutoff_h <= 0 or now() < bk.start_at - make_interval(secs => cutoff_h * 3600) then
    return jsonb_build_object('ok', false, 'reason', 'just_do_it');
  end if;

  if p_kind = 'move' then
    select c.availability into av from public.coaches c where c.id = bk.coach_id;
    if not public.availability_allows(av, p_new_start, p_new_end) then
      return jsonb_build_object('ok', false, 'reason', 'not_open');
    end if;
    -- Not a hold — only a courtesy check so the coach is not asked to approve
    -- something already impossible. It can still be taken before they answer.
    if exists (select 1 from public.bookings b2
                where b2.coach_id = bk.coach_id and b2.start_at = p_new_start and b2.status = 'booked') then
      return jsonb_build_object('ok', false, 'reason', 'taken');
    end if;
  end if;

  begin
    insert into public.booking_requests
      (id, booking_id, coach_id, athlete_id, kind, new_start_at, new_end_at, note)
    values
      (p_id, bk.id, bk.coach_id, bk.athlete_id, p_kind,
       case when p_kind = 'move' then p_new_start end,
       case when p_kind = 'move' then p_new_end end,
       nullif(left(coalesce(p_note, ''), 300), ''));
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'pending');
  end;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function public.withdraw_booking_request(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.booking_requests
     set status = 'withdrawn', resolved_at = now()
   where id = p_id and status = 'pending'
     and athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- the coach's answer ----------
-- Approving performs the change; denying leaves the booking exactly as it was.
-- Session tokens are deliberately untouched here: the balance lives in the
-- `session_bank` jsonb on the athlete row, which only the coach's browser
-- writes, so waiving-or-charging a late cancel is done there (see app.js,
-- autoRedeemFinishedBookings / refundBookingTokens) and not in this function.
create or replace function public.resolve_booking_request(
  p_id text, p_approve boolean, p_new_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rq public.booking_requests%rowtype;
  bk public.bookings%rowtype;
begin
  select * into rq from public.booking_requests r
   where r.id = p_id and r.status = 'pending'
     and r.coach_id in (select id from public.coaches where auth_user_id = (select auth.uid()));
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;

  if not p_approve then
    update public.booking_requests set status = 'denied', resolved_at = now() where id = rq.id;
    return jsonb_build_object('ok', true, 'kind', rq.kind, 'approved', false);
  end if;

  select * into bk from public.bookings where id = rq.booking_id;
  if bk.status <> 'booked' then
    -- Already gone by another route. Close the request rather than leaving it
    -- pending forever against a booking that no longer exists.
    update public.booking_requests set status = 'approved', resolved_at = now() where id = rq.id;
    return jsonb_build_object('ok', true, 'kind', rq.kind, 'approved', true, 'noop', true);
  end if;

  if rq.kind = 'cancel' then
    update public.bookings
       set status = 'cancelled', cancelled_at = now()
     where id = bk.id;
    update public.booking_requests set status = 'approved', resolved_at = now() where id = rq.id;
    return jsonb_build_object('ok', true, 'kind', 'cancel', 'approved', true,
                              'bookingId', bk.id, 'googleEventId', bk.google_event_id);
  end if;

  -- Same carry-and-swap as athlete_move_booking, and it can still lose the race
  -- to the slot: the request never held it. The request stays pending so the
  -- coach can deny it or ask for another time.
  begin
    insert into public.bookings
      (id, coach_id, athlete_id, start_at, end_at, status, note, created_by, google_event_id, series_id)
    values
      (coalesce(nullif(p_new_id, ''), rq.id || '-m'), bk.coach_id, bk.athlete_id,
       rq.new_start_at, rq.new_end_at, 'booked', bk.note, bk.created_by, bk.google_event_id, bk.series_id);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');
  end;

  update public.bookings
     set status = 'cancelled', cancelled_at = now(), google_event_id = null
   where id = bk.id;
  update public.booking_requests set status = 'approved', resolved_at = now() where id = rq.id;

  return jsonb_build_object('ok', true, 'kind', 'move', 'approved', true,
                            'id', coalesce(nullif(p_new_id, ''), rq.id || '-m'), 'oldId', bk.id);
end;
$$;

revoke all on function public.coach_cancel_hours(text) from public;
revoke all on function public.athlete_move_booking(text, text, timestamptz, timestamptz) from public;
revoke all on function public.request_booking_change(text, text, text, timestamptz, timestamptz, text) from public;
revoke all on function public.withdraw_booking_request(text) from public;
revoke all on function public.resolve_booking_request(text, boolean, text) from public;
grant execute on function public.coach_cancel_hours(text) to authenticated;
grant execute on function public.athlete_move_booking(text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.request_booking_change(text, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.withdraw_booking_request(text) to authenticated;
grant execute on function public.resolve_booking_request(text, boolean, text) to authenticated;

-- ---------- what the athlete is told ----------
-- `cancelHours` must reach an athlete who may NOT self-book. That is not an
-- oversight in the withholding added by 20260804160000_booking_permission.sql —
-- those athletes can still cancel (the UPDATE policy was left open on purpose,
-- so revoking booking never strands somebody with a session they cannot get out
-- of), and without this the notice window would be invisible to exactly the
-- people the coach books by hand. The working hours stay withheld.
create or replace function public.availability_for_athlete()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select case when coalesce(a.can_book, false)
    then coalesce(c.availability, '{}'::jsonb) || jsonb_build_object('canBook', true)
    else jsonb_build_object(
           'canBook', false,
           'cancelHours', coalesce(c.availability->'cancelHours', to_jsonb(24)))
  end
  from public.athletes a
  join public.coaches c on c.id = a.coach_id
  where a.auth_user_id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.availability_for_athlete() from public;
grant execute on function public.availability_for_athlete() to authenticated;

-- ---------- push subscriptions learn about coaches ----------
-- Until now this table was athlete-only, which is why the coach has never had a
-- notification of any kind: `send-push` requires a coach caller and sends to
-- athletes. A pending request that only lights up an in-app pill is no use to
-- somebody who finds out by opening the app, so the coach gets a real device.
alter table public.push_subscriptions
  add column if not exists coach_id text references public.coaches(id) on delete cascade;

alter table public.push_subscriptions
  alter column athlete_id drop not null;

-- Exactly one owner. Existing rows have athlete_id set and coach_id null, so
-- they satisfy this unchanged.
alter table public.push_subscriptions
  drop constraint if exists push_sub_one_owner;
alter table public.push_subscriptions
  add constraint push_sub_one_owner
  check ((athlete_id is not null) <> (coach_id is not null));

create index if not exists push_subscriptions_coach_idx
  on public.push_subscriptions (coach_id);

-- The existing athlete policy needs no change: on a coach row `athlete_id` is
-- null, so its `in (...)` test is null rather than true and the row stays
-- invisible to every athlete.
drop policy if exists "coach manages own push subscriptions" on public.push_subscriptions;
create policy "coach manages own push subscriptions" on public.push_subscriptions
  for all
  using (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())))
  with check (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())));
