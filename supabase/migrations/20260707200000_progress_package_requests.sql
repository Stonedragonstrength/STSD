-- Athlete package purchase requests ride along with progress sync, so the
-- coach app sees them without the manual "Send progress" paste flow.
alter table public.progress
  add column if not exists package_requests jsonb not null default '[]'::jsonb;
