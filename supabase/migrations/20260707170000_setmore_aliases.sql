-- Setmore booking names an athlete is known by (normalized lowercase),
-- so booked sessions can be matched to athlete profiles on every coach device.
alter table public.athletes
  add column if not exists setmore_aliases jsonb not null default '[]'::jsonb;
