-- Pre-workout readiness check-in: three taps (sleep / soreness / stress) the
-- athlete answers before the first set of a day. Lives on progress because it
-- is athlete-owned -- the coach app upserts whole athlete rows, so anything on
-- `athletes` gets clobbered by a coach save.
-- Shape, latest answer per day, mirroring workout_moods:
--   { "<dayId>": { date, sleep, sore, stress, score } }
-- sleep/sore/stress are 1..3 (rough / okay / good), score is their sum (3..9).
alter table public.progress
  add column if not exists readiness jsonb not null default '{}'::jsonb;
