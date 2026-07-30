-- Menstrual cycle tracking. Opt-in, athlete-owned, PRIVATE BY DEFAULT.
--
-- Why its own table and not `progress`: the coach reads whole progress rows, so
-- "store it there and just don't render it coach-side" would not be privacy at
-- all -- it would be a UI convention protecting medical data. This table has no
-- coach policy whatsoever. The only way anything reaches a coach is the
-- SECURITY DEFINER function below, and only for athletes who switched sharing on.
--
-- Shapes:
--   periods : [ { id, start:"YYYY-MM-DD", end:"YYYY-MM-DD"|null, flow:"light|medium|heavy"|null } ]
--   notes   : { "YYYY-MM-DD": { symptoms:[...], note:"" } }   -- share_level 'all' only

create table if not exists public.cycle_logs (
  athlete_id  text primary key,
  -- Off until the athlete turns it on in Profile. A row can exist while off
  -- (they tried it and stopped) -- `enabled` is what the share RPC checks.
  enabled     boolean not null default false,
  -- private: nobody but them. phase: the coach sees dates, so a day number and
  -- a phase name, and nothing else. all: flow and symptom notes too.
  share_level text not null default 'private'
              check (share_level in ('private', 'phase', 'all')),
  periods     jsonb not null default '[]'::jsonb,
  notes       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.cycle_logs enable row level security;

-- The athlete, and only the athlete. There is deliberately no coach policy here.
create policy "athlete manages own cycle log" on public.cycle_logs
  for all
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())))
  with check (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));

-- The one door out. Returns a row per athlete of the CALLING coach who has
-- tracking on and sharing set to something other than private, redacted to
-- exactly the level that athlete chose. 'phase' athletes have flow stripped
-- field by field here rather than trusted to a client that might forget.
create or replace function public.cycle_shares_for_coach()
returns table (athlete_id text, share_level text, periods jsonb, notes jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select
    cl.athlete_id,
    cl.share_level,
    case when cl.share_level = 'all' then cl.periods
         else coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', p->>'id', 'start', p->>'start', 'end', p->>'end'))
           from jsonb_array_elements(cl.periods) p
         ), '[]'::jsonb)
    end as periods,
    case when cl.share_level = 'all' then cl.notes else '{}'::jsonb end as notes
  from public.cycle_logs cl
  join public.athletes a on a.id = cl.athlete_id
  join public.coaches  c on c.id = a.coach_id
  where c.auth_user_id = (select auth.uid())
    and cl.enabled
    and cl.share_level in ('phase', 'all');
$$;

grant execute on function public.cycle_shares_for_coach() to authenticated;
