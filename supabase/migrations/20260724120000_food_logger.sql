-- Athlete-set nutrition targets + the food logger.
--
-- All four live on `progress` (athlete-owned) rather than `athletes`, because
-- the coach upserts whole athlete rows and would clobber anything the athlete
-- wrote there. Same reasoning as added_exercises.
--
-- nutrition_targets: the athlete's own targets and which set is in play.
--   { mode: "coach" | "own",
--     calories, proteinPct, carbsPct, fatPct, protein, carbs, fat,
--     updatedAt,
--     calc: { heightIn, age, sex, activity, goal, tdee } | null }
--   The coach's plan still lives in athletes.nutrition; `mode` picks between
--   them, and athletes.nutrition.current.locked lets the coach force "coach".
alter table public.progress
  add column if not exists nutrition_targets jsonb not null default '{}'::jsonb;

-- food_log: logged food keyed by date. Pruned to a rolling window in the app
--   so the row stays light (the whole progress row is upserted on each push).
--   { "YYYY-MM-DD": [ { id, name, meal, qty, unit, grams, kcal, p, c, f, src, ref, at } ] }
alter table public.progress
  add column if not exists food_log jsonb not null default '{}'::jsonb;

-- custom_foods: athlete-created foods (protein powder, a usual takeout order).
--   [ { id, name, brand, unit, unitGrams, kcal, p, c, f, uses, createdAt } ]
alter table public.progress
  add column if not exists custom_foods jsonb not null default '[]'::jsonb;

-- saved_meals: a named bundle of entries logged in one tap.
--   [ { id, name, items: [ { ...entry } ], uses, createdAt } ]
alter table public.progress
  add column if not exists saved_meals jsonb not null default '[]'::jsonb;
