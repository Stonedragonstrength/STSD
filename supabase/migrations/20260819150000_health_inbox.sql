-- Apple Health in-path: a mailbox, not a direct write.
--
-- The health-sync Edge Function (called by an athlete's iOS Shortcut) must
-- never write progress columns directly: merge_progress replaces whole
-- columns from the device payload, so anything landed server-side would be
-- wiped by the athlete's next push from a device that predates it. Instead
-- the function drops batches here, and the athlete's own app drains the
-- mailbox on boot — merging locally with the same dedupe the Renpho import
-- uses, saving, then deleting the consumed rows. localStorage stays the
-- source of truth.
--
-- The token authenticates the Shortcut, which cannot carry a Supabase JWT.
-- It is generated in-app by the athlete and lives on their row; RLS already
-- lets an athlete read and update their own row, so no new policy is needed
-- for it. A unique index keeps one token from ever matching two athletes.

alter table public.athletes add column if not exists health_token text;
create unique index if not exists athletes_health_token_key
  on public.athletes (health_token) where health_token is not null;

create table if not exists public.health_inbox (
  id bigint generated always as identity primary key,
  athlete_id text not null references public.athletes(id) on delete cascade,
  kind text not null default 'health-batch',
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists health_inbox_athlete_idx
  on public.health_inbox (athlete_id, id);

alter table public.health_inbox enable row level security;

-- The athlete drains their own mailbox. Nobody inserts through RLS: the
-- Edge Function writes with the service role, and that is the only door in.
create policy "athlete reads own health inbox" on public.health_inbox
  for select
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));

create policy "athlete deletes own health inbox" on public.health_inbox
  for delete
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));
