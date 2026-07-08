-- Standing per-athlete nutrition plan + change history.
-- Shape: { current: { calories, protein, carbs, fat, notes, effectiveFrom } | null,
--          history: [ { ...plan, endedAt } ] }
alter table public.athletes
  add column if not exists nutrition jsonb not null default '{"current":null,"history":[]}'::jsonb;
