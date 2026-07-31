-- Pounds or kilos, per athlete.
--
-- Storage does not change: every weight in `athletes.weeks`, `progress` and
-- the PR board stays in pounds, forever. The Hoard's ranks are frozen against
-- lb totals and PRs chain across years by raw number, so converting stored
-- data would rewrite history. This column only decides what an athlete reads
-- and types; the app converts at the edges.
--
-- Lives on `athletes` rather than `progress` because the coach sets it too —
-- programming for a kg gym means the coach's weight picker has to speak kg
-- while they write the program.
alter table public.athletes
  add column if not exists units text not null default 'lb'
  check (units in ('lb', 'kg'));
