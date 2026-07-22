-- Post-workout mood check-in: how the athlete felt on each completed day.
-- Shape: { "<dayId>": { "date": "YYYY-MM-DD", "moods": ["strong","wantmore"] } }
-- Persisted on progress so it survives the cloud pull on each open.
alter table public.progress
  add column if not exists workout_moods jsonb not null default '{}'::jsonb;
