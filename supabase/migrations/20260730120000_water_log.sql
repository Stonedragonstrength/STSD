-- Water tracking.
--
-- Lives on `progress` with the rest of the food logger, for the same reason:
-- the coach upserts whole `athletes` rows and would clobber anything the
-- athlete wrote there.
--
-- water_log: servings logged per day. One number per date, not a list of
--   events — a glass of water has no properties worth keeping, and a count
--   keeps the row light next to food_log.
--   { "YYYY-MM-DD": 8 }
--
-- The daily goal is NOT here. It rides in progress.nutrition_targets
-- (`waterGoal`) alongside the calorie and macro numbers, so a target is a
-- target wherever it's read from.
alter table public.progress
  add column if not exists water_log jsonb not null default '{}'::jsonb;
