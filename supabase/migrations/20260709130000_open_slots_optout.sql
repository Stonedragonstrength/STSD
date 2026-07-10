-- Per-athlete opt-out for open-slot alerts. Lets a coach silence clients who
-- are on a steady schedule and don't need to see openings.

alter table public.athletes
  add column if not exists hide_open_slots boolean not null default false;

-- open_slots_for_athlete now returns [] for opted-out athletes (defense in
-- depth — the athlete app also hides the card when the flag is set).
create or replace function public.open_slots_for_athlete()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select case
           when coalesce(a.hide_open_slots, false) then '[]'::jsonb
           else coalesce(c.open_slots, '[]'::jsonb)
         end
  from public.coaches c
  join public.athletes a on a.coach_id = c.id
  where a.auth_user_id = (select auth.uid())
  limit 1;
$$;
