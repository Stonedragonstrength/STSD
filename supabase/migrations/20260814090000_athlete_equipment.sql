-- What this athlete has to train with, as a list of GEAR ids.
--
-- Feeds the program builder. Exercise names do not say what they require, so
-- EXERCISE_EQUIPMENT maps each movement to the ways it can be performed, and
-- this column says which of those ways are open to this athlete. A gym with
-- dumbbells and a bench but no barbell gets a dumbbell bench press rather than
-- no chest press at all.
--
-- jsonb rather than text[], matching how every other list on this table is
-- stored (weeks, coach_prs, trials) so the cloud mapping stays uniform.
--
-- Nullable, and an empty list means the same thing as NULL: everything is
-- available. An athlete whose gear was never filled in must be unrestricted,
-- never unable to be programmed for.
alter table public.athletes
  add column if not exists equipment jsonb;
