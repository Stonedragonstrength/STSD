-- The two per-athlete settings the coach's training hub adds, alongside the
-- equipment column from 20260814090000.
--
-- These sit on `athletes` rather than on a program, because they describe the
-- PERSON and outlive any block: swapping someone onto a new program should not
-- forget that they train four days a week and have a bad back.

-- How many days a week they train. Seeds the program builder so the coach is
-- not re-picking it on every build. 0 (and NULL) mean never set, and the
-- builder falls back to its own default rather than assuming a number.
alter table public.athletes
  add column if not exists days_per_week smallint not null default 0;

-- Pain relief is a CONSTRAINT, not a volume target, which is why it is a flag
-- here rather than another row in TRAINING_PHASES. A phase says how many sets
-- grade as enough; this says what should get programmed at all — favour
-- mobility, ease off loaded spinal work. Folding it into the phase list would
-- have made it silently change volume grading instead.
alter table public.athletes
  add column if not exists pain_relief boolean not null default false;

-- Guard the day count rather than trusting the client: this is the one field a
-- future athlete-facing surface is most likely to write, and a nonsense value
-- would reach the builder before anyone noticed.
do $$ begin
  alter table public.athletes
    add constraint athletes_days_per_week_range check (days_per_week between 0 and 7);
exception when duplicate_object then null; end $$;
