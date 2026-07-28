-- Pickable pixel-art avatars.
--
-- The athlete's pick lives on `progress`, not `athletes`, for the same reason
-- athlete_days does: the coach app upserts whole athlete rows, so anything on
-- `athletes` that only the athlete writes gets clobbered by the next coach
-- save. The coach reads it back off the athlete's synced progress.
--
-- The coach's own pick can live on `coaches` safely, since that table is only
-- ever touched by targeted column updates, never a full-row upsert.
alter table public.progress
  add column if not exists avatar_id text;

alter table public.coaches
  add column if not exists avatar_id text;
