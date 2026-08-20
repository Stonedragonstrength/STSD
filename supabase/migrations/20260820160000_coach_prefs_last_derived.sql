-- The derived coach notifications need their own "already done today" stamp.
--
-- coach-digest runs every 15 minutes and does two things on the coach's local
-- clock: it works out the kinds nothing raises (athlete_quiet,
-- month_uncollected) and then it sends the digest. Both must happen once a
-- day, and last_digest_on cannot mark both: a pass that computes the derived
-- kinds but sends no digest -- because the coach has them set to instant, or
-- to off, so nothing was queued -- never stamps it, and fifteen minutes later
-- the sweep runs again and pushes the same thing.
--
-- Nullable with no default: a coach who has never been swept simply has not
-- been swept, and the first pass past their digest time does it.
alter table coach_prefs add column if not exists last_derived_on date;

comment on column coach_prefs.last_derived_on is
  'Local date the derived-kind sweep last ran for this coach. See coach-digest.';
