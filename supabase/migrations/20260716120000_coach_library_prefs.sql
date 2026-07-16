-- Coach exercise-library customizations, synced across devices:
-- { customExercises: [{ name, cat }], hiddenExercises: [name], exCatOrder: [cat] }
alter table public.coaches
  add column if not exists library_prefs jsonb not null default '{}'::jsonb;
