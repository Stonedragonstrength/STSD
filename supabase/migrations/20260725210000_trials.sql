-- Trials: coach-authored challenges per athlete ("squat 315", "100 workouts",
-- "compete in a meet"). The Hoard is the passive number that always climbs;
-- Trials are the active goals to chase. Auto-evaluated from progress for every
-- kind except `manual`, which the coach ticks off by hand.
--
-- trials: [{ id, name, icon, kind, lift, weight, reps, n, doneAt }]
--   kind: "lift" | "workouts" | "tonnage" | "streak" | "manual"
alter table public.athletes
  add column if not exists trials jsonb not null default '[]'::jsonb;

-- Coach-owned column: extend the athlete self-edit guard so an athlete can't
-- author or complete their own trials (same class as weeks/one_off_days).
create or replace function public.athletes_guard_athlete_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Trusted server-side contexts (service role / no JWT) bypass the guard.
  if auth.uid() is null then
    return new;
  end if;

  -- The owning coach may change anything on their own athletes' rows.
  if exists (
    select 1 from public.coaches
    where id = new.coach_id
      and auth_user_id = auth.uid()
  ) then
    return new;
  end if;

  -- Otherwise this is an athlete editing their own row. Coach-owned and
  -- structural columns must stay exactly as they were.
  if new.coach_id        is distinct from old.coach_id
     or new.invite_code     is distinct from old.invite_code
     or new.session_bank    is distinct from old.session_bank
     or new.weeks           is distinct from old.weeks
     or new.schedule        is distinct from old.schedule
     or new.notes           is distinct from old.notes
     or new.nutrition       is distinct from old.nutrition
     or new.setmore_aliases is distinct from old.setmore_aliases
     or new.one_off_days    is distinct from old.one_off_days
     or new.trials          is distinct from old.trials
  then
    raise exception 'athletes: only your own profile fields are editable';
  end if;

  -- The auth link may only move from unclaimed -> the caller (the claim
  -- flow). It can never be reassigned to another user or overwritten.
  if new.auth_user_id is distinct from old.auth_user_id
     and not (old.auth_user_id is null and new.auth_user_id = auth.uid())
  then
    raise exception 'athletes: the account link is not athlete-editable';
  end if;

  return new;
end;
$$;
