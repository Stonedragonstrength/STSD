-- Athlete-built one-off sessions: dated days the athlete throws together
-- themselves (a solo gym day, a lift they did on vacation) outside the coach's
-- program. Same idea as the coach's one_off_days on athletes, but stored on
-- progress because it's athlete-owned: the coach app upserts whole athlete
-- rows, so anything living on `athletes` gets clobbered by a coach save.
-- Shape: [ { id, date, name, icon, byAthlete:true, createdAt, exercises:[...] } ]
alter table public.progress
  add column if not exists athlete_days jsonb not null default '[]'::jsonb;
