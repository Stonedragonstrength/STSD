-- Athlete "add an exercise on the fly": exercises the athlete tacks onto a day
-- from the library when they end up doing more than the coach programmed.
-- Stored on progress (athlete-owned) so they survive the coach re-syncing the
-- program AND show up on the coach side. Capped to 8 per day in the app.
-- Shape: { "<dayId>": [ { id, name, sets, currentReps, ..., addedByAthlete:true } ] }
alter table public.progress
  add column if not exists added_exercises jsonb not null default '{}'::jsonb;
