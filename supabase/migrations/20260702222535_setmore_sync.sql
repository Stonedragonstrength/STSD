-- Setmore calendar sync: per-coach ICS feed URL + synced events table.
-- Matches the existing schema's conventions: text ids, snake_case columns,
-- no RLS (this project doesn't use RLS anywhere yet).

alter table public.coaches
  add column if not exists setmore_ics_url text;

create table if not exists public.setmore_events (
  coach_id text not null references public.coaches(id) on delete cascade,
  external_uid text not null,
  client_name text,
  title text,
  start_at timestamptz not null,
  end_at timestamptz,
  raw jsonb,
  synced_at timestamptz not null default now(),
  primary key (coach_id, external_uid)
);

create index if not exists setmore_events_coach_start_idx
  on public.setmore_events (coach_id, start_at);
