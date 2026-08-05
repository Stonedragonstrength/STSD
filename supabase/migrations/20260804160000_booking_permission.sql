-- Per-athlete permission to self-book.
--
-- Until now, publishing availability opened booking to the whole roster at
-- once: any athlete with an account could take any free slot. The coach wants
-- the opposite default — booking is granted to specific people, not withheld
-- from the rest. So this is opt-IN, `default false`, and every existing athlete
-- starts switched off. Safe to do that here because no athlete has ever
-- self-booked (all 680 bookings on the day of this migration were created_by
-- 'coach'), so switching the default off takes nothing away from anyone.

alter table public.athletes
  add column if not exists can_book boolean not null default false;

-- ---------- the actual gate ----------
-- The UI hides the slot grid, but the UI is a courtesy: an athlete who is not
-- allowed to book must be unable to insert the row, not merely unable to find
-- the button. This policy is the enforcement point.
--
-- Deliberately scoped to INSERT only. The athlete UPDATE policy (cancel) is
-- left alone: revoking booking must not strand somebody with a session they
-- can no longer get out of.
drop policy if exists "athlete books for self" on public.bookings;
create policy "athlete books for self" on public.bookings
  for insert to authenticated
  with check (
    created_by = 'athlete'
    and status = 'booked'
    and athlete_id in (
      select id from public.athletes
      where auth_user_id = (select auth.uid())
        and can_book
    )
  );

-- The coach's own "coach manages own bookings" policy is untouched, so the
-- coach can still book anybody in the roster regardless of this flag. That is
-- the point of the flag: it governs who may book THEMSELVES.

-- ---------- what the athlete is told ----------
-- Now returns the permission alongside the hours, so the athlete side can say
-- "your coach books your sessions" instead of a bare empty list.
--
-- When the athlete may not book, the windows themselves are withheld rather
-- than sent-and-hidden. Two reasons: a coach's working hours aren't an
-- athlete's business until they can act on them, and a cached PWA still on the
-- old build (which knows nothing about `canBook`) then generates zero slots and
-- falls through to its "no hours posted yet" copy, instead of showing a grid of
-- buttons where every tap fails the policy above.
create or replace function public.availability_for_athlete()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select case when coalesce(a.can_book, false)
    then coalesce(c.availability, '{}'::jsonb) || jsonb_build_object('canBook', true)
    else jsonb_build_object('canBook', false)
  end
  from public.athletes a
  join public.coaches c on c.id = a.coach_id
  where a.auth_user_id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.availability_for_athlete() from public;
grant execute on function public.availability_for_athlete() to authenticated;
