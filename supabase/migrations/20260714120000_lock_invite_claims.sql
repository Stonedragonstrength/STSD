-- Harden the athlete account model in two ways:
--
--   (a) A leaked invite code can no longer TAKE OVER an already-claimed
--       account. claim_athlete_by_invite_code now only links a row that is
--       currently unclaimed (auth_user_id is null) or is being re-claimed by
--       its existing owner (idempotent). To re-invite an athlete who lost
--       access, the coach regenerates the code, which also clears the auth
--       link (see Cloud.unlinkAthleteAuth in cloud.js) so the row is
--       unclaimed again and can be claimed fresh.
--
--   (b) Athletes can only edit their own PROFILE-ish fields. The prior
--       "athlete updates own row" RLS policy allowed changing any column, so
--       via the console an athlete could rewrite their session_bank (grant
--       themselves sessions), edit their program (weeks), or reassign
--       coach_id. A BEFORE UPDATE trigger now rejects athlete-side changes to
--       coach-owned / structural columns. The owning coach (and trusted
--       service-role jobs) keep full control.

-- ---------- (a) claim only an unclaimed account ----------

create or replace function public.claim_athlete_by_invite_code(code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  if auth.uid() is null then
    return false;
  end if;
  -- Only an unclaimed row (or the current owner, idempotently) may be linked.
  -- A different user holding a leaked code cannot seize an active account.
  update public.athletes
     set auth_user_id = auth.uid()
   where invite_code = code
     and (auth_user_id is null or auth_user_id = auth.uid());
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

grant execute on function public.claim_athlete_by_invite_code(text) to anon, authenticated;

-- ---------- (b) column-level guard for athlete self-edits ----------

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

drop trigger if exists athletes_guard_columns on public.athletes;
create trigger athletes_guard_columns
  before update on public.athletes
  for each row execute function public.athletes_guard_athlete_columns();
