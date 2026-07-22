-- Lifetime active-workout time (milliseconds) accumulated while an athlete is in
-- a day's workout detail. Persisted on progress so it survives the cloud pull on
-- each open (see progress-cloud-mapping gotcha).
alter table public.progress
  add column if not exists total_workout_ms bigint not null default 0;
