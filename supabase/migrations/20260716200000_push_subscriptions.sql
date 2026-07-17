-- Web-push subscriptions, one row per athlete device/browser.
-- Written by the athlete's own authenticated client when they enable
-- notifications; read only by the send-push Edge Function (service role,
-- bypasses RLS), which also prunes dead endpoints (404/410 on send).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  athlete_id text not null,
  endpoint text not null unique,
  subscription jsonb not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_athlete_idx on public.push_subscriptions (athlete_id);

alter table public.push_subscriptions enable row level security;

-- Athletes manage their own devices' subscriptions.
create policy "athlete manages own push subscriptions" on public.push_subscriptions
  for all
  using (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())))
  with check (athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid())));
