-- Athlete cardio log entries: { id, date, type, minutes, intensity }
alter table public.progress
  add column if not exists cardio_logs jsonb not null default '[]'::jsonb;
