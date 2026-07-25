-- Nutrition game state: XP, level and the streak record behind the food tab's
-- HUD. Lives on `progress` alongside food_log for the usual reason (the coach
-- upserts whole athlete rows and would clobber anything written to `athletes`).
--
-- Every number here except `xp` and `bestStreak` is derivable from food_log, so
-- this column exists only to survive the log's 180-day prune: `xp` is a
-- lifetime total that must never go down when old days age out.
--
-- nutrition_game:
--   { xp: 0,                          -- lifetime, monotonic
--     awarded: { "YYYY-MM-DD": 42 },  -- XP already banked per day, pruned with
--                                     -- the log so a re-scored day can be
--                                     -- corrected rather than double-counted
--     bestStreak: 0 }
alter table public.progress
  add column if not exists nutrition_game jsonb not null default '{}'::jsonb;
