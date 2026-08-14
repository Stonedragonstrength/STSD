-- Which training block this athlete is in, and therefore how their coverage
-- map is graded.
--
-- The map counted every programmed set the same way, which is right for someone
-- building and wrong for someone cutting: in a deficit the volume comes down on
-- purpose and the sets that remain have to be taken hard to defend the muscle.
-- Graded on the building ladder, a well-written fat-loss week came back as a
-- screen of gaps.
--
-- So a phase lowers the bands (fat loss 3/5, maintenance 2/4, against a
-- building intermediate's 8/10) and only counts sets the coach marked intense
-- enough (fat loss: Hard or Max; maintenance: Moderate and up) via ex.effort.
--
-- Lives on `athletes` beside `training_level`, for the same reason: the coach
-- sets it and the athlete's own copy of the map reads it.
--
-- Nullable rather than `not null default ''`: athleteToRow coerces every
-- optional field's empty string to null (`c.trainingPhase || null`), so a
-- not-null column would reject an unphased athlete on its first write. NULL is
-- the storage form of "building", and levelBands() resolves it straight back to
-- the training-age ladder — today's exact numbers, so no athlete's map moves
-- until a phase is deliberately assigned.
alter table public.athletes
  add column if not exists training_phase text
  check (training_phase is null or training_phase in ('fatloss', 'maintenance'));
