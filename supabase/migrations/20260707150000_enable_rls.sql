-- Enable Row Level Security on all app tables.
--
-- Access model:
--   * Coaches sign in with Supabase Auth; coaches.auth_user_id ties rows to them.
--   * Athletes claim their athletes row via invite code on first login, which
--     sets athletes.auth_user_id; after that they operate as themselves.
--   * The invite-code flow runs before the athlete has an account, so it goes
--     through SECURITY DEFINER functions below — knowing the exact code is the
--     authorization, and nothing exposes a table-wide read to anon.
--   * The sync-setmore Edge Function uses the service-role key, which bypasses
--     RLS entirely, so it needs no policies.

alter table public.coaches enable row level security;
alter table public.athletes enable row level security;
alter table public.progress enable row level security;
alter table public.athlete_profiles enable row level security;
alter table public.setmore_events enable row level security;

-- ---------- coaches ----------

create policy "coach manages own row" on public.coaches
  for all
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- ---------- athletes ----------

create policy "coach manages own athletes" on public.athletes
  for all
  using (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())))
  with check (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())));

create policy "athlete reads own row" on public.athletes
  for select
  using (auth_user_id = (select auth.uid()));

-- Athletes can push edits (e.g. shared PR list) back to their own row.
create policy "athlete updates own row" on public.athletes
  for update
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- ---------- progress ----------

create policy "coach manages own athletes progress" on public.progress
  for all
  using (athlete_id in (
    select a.id from public.athletes a
    join public.coaches c on c.id = a.coach_id
    where c.auth_user_id = (select auth.uid())))
  with check (athlete_id in (
    select a.id from public.athletes a
    join public.coaches c on c.id = a.coach_id
    where c.auth_user_id = (select auth.uid())));

create policy "athlete manages own progress" on public.progress
  for all
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())))
  with check (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));

-- ---------- athlete_profiles ----------

create policy "athlete manages own profile" on public.athlete_profiles
  for all
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())))
  with check (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));

create policy "coach reads own athletes profiles" on public.athlete_profiles
  for select
  using (athlete_id in (
    select a.id from public.athletes a
    join public.coaches c on c.id = a.coach_id
    where c.auth_user_id = (select auth.uid())));

-- ---------- setmore_events ----------
-- Written only by the sync-setmore Edge Function (service role).

create policy "coach reads own setmore events" on public.setmore_events
  for select
  using (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())));

-- ---------- Invite-code RPCs (SECURITY DEFINER) ----------
-- These are the only anon-reachable reads. Each requires the exact invite
-- code, so they leak nothing without it.

create or replace function public.athlete_by_invite_code(code text)
returns setof public.athletes
language sql
security definer
set search_path = public
stable
as $$
  select * from public.athletes where invite_code = code;
$$;

create or replace function public.progress_by_invite_code(code text)
returns setof public.progress
language sql
security definer
set search_path = public
stable
as $$
  select p.* from public.progress p
  join public.athletes a on a.id = p.athlete_id
  where a.invite_code = code;
$$;

-- Called right after the athlete signs up: stamps their auth user id onto the
-- athletes row matching the invite code. Overwrites any previous link, same as
-- the pre-RLS behavior (re-linking after a deleted/orphaned account).
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
  update public.athletes set auth_user_id = auth.uid() where invite_code = code;
  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

grant execute on function public.athlete_by_invite_code(text) to anon, authenticated;
grant execute on function public.progress_by_invite_code(text) to anon, authenticated;
grant execute on function public.claim_athlete_by_invite_code(text) to anon, authenticated;
