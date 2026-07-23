-- Form checks: short athlete-recorded workout clips the coach reviews.
--
-- Metadata rides the athlete-owned progress row (like day_notes / workout_moods)
-- so it syncs through the existing progress path in both directions — the athlete
-- appends clips, the coach flips reviewed/coachReply on the same jsonb. Shape:
--   { "<dayId>": [ { id, path, uploadedAt, note, reviewed, reviewedAt, coachReply, sizeBytes, durationSec, downscaled } ] }
-- The video files themselves live in the private `form-checks` Storage bucket,
-- keyed `<athleteId>/<dayId>/<uid>.webm`. Clips auto-prune after 30 days
-- (prune-form-checks Edge Function on a daily cron).
alter table public.progress
  add column if not exists form_checks jsonb not null default '{}'::jsonb;

-- Private bucket. 50 MiB hard cap per object (matches the plan's Storage limit);
-- the client downscales to 720p30 first, so real clips land far under this.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'form-checks',
  'form-checks',
  false,
  52428800,
  array['video/webm','video/mp4','video/quicktime']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- Storage RLS ----------
-- Path convention: the first folder segment is the owning athlete's id, so every
-- policy gates on (storage.foldername(name))[1]. Video of someone training is
-- more sensitive than a set log, so nothing here is public-readable.

-- The athlete owns everything under their own folder (upload / read / delete).
create policy "athlete manages own form checks" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'form-checks'
    and (storage.foldername(name))[1] in (
      select id from public.athletes where auth_user_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'form-checks'
    and (storage.foldername(name))[1] in (
      select id from public.athletes where auth_user_id = (select auth.uid())
    )
  );

-- The coach can read (for signed-URL playback) and delete their own athletes' clips.
create policy "coach reads own athletes form checks" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'form-checks'
    and (storage.foldername(name))[1] in (
      select a.id from public.athletes a
      join public.coaches c on c.id = a.coach_id
      where c.auth_user_id = (select auth.uid())
    )
  );

create policy "coach deletes own athletes form checks" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'form-checks'
    and (storage.foldername(name))[1] in (
      select a.id from public.athletes a
      join public.coaches c on c.id = a.coach_id
      where c.auth_user_id = (select auth.uid())
    )
  );
