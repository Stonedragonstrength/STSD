-- Which volume ladder this athlete's coverage map is graded against.
--
-- The muscle map shipped grading everyone at 6 sets a muscle "solid" and 12
-- "plenty" — a trained lifter's numbers. A correct beginner program (full body,
-- three days, four to six sets a muscle) came back as six warnings, so the map
-- scolded the coach for writing a good program and trained him out of trusting
-- it.
--
-- Lives on `athletes` rather than `progress` because the coach sets it and the
-- athlete's own copy of the map reads it, exactly like `units`.
--
-- Nullable rather than `not null default 'intermediate'`: athleteToRow coerces
-- every optional field's empty string to null (`c.goals || null`), so a not-null
-- column would reject an unset athlete on its first write. NULL is the storage
-- form of "not set", and levelBands() resolves it to intermediate on read —
-- which is today's exact numbers, so no athlete's map moves until a level is
-- deliberately assigned.
alter table public.athletes
  add column if not exists training_level text
  check (training_level is null or training_level in ('beginner', 'intermediate', 'advanced'));
