-- Bug reports: in-app "Report a problem" submissions, each carrying a
-- diagnostics snapshot (recent JS errors, console output, taps, device info)
-- captured by bugreport.js. Anyone can file one (login-screen bugs happen
-- before auth); only a signed-in coach can read or clear them.

create table public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  reporter_role text not null default '',
  reporter_name text not null default '',
  athlete_id text,
  description text not null default '' check (char_length(description) <= 5000),
  diagnostics jsonb not null default '{}'::jsonb
);

alter table public.bug_reports enable row level security;

create policy "anyone can file a bug report" on public.bug_reports
  for insert to anon, authenticated
  with check (true);

create policy "coach reads bug reports" on public.bug_reports
  for select
  using (exists (select 1 from public.coaches where auth_user_id = (select auth.uid())));

create policy "coach deletes bug reports" on public.bug_reports
  for delete
  using (exists (select 1 from public.coaches where auth_user_id = (select auth.uid())));
