-- Athlete exercise swaps: the machine was taken, or a joint said no, so the
-- athlete ran a different movement in place of the prescribed one. The swap
-- keys off the exercise's id, which is what keeps its prescribed sets/weight/
-- reps, its progression rule and everything already logged against it intact —
-- only which lift it is changes.
--
-- Stored on progress, not on athletes: the coach app upserts whole athlete
-- rows, so a swap living on `athletes` would be clobbered by the next coach
-- save. Same reasoning as athlete_days and added_exercises.
--
-- Shape: { "<exerciseId>": { name, from, at } }
alter table public.progress
  add column if not exists swaps jsonb not null default '{}'::jsonb;
