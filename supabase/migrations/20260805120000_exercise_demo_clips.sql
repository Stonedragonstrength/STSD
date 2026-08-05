-- Coach-recorded demo clips, for lifts the vendored still library has nothing
-- for. exercise-demos.js covers the staples well and the long tail badly, and
-- some accessory work simply isn't in free-exercise-db — those exercises show
-- "No demo matched" and the athlete gets no picture at all.
--
-- Only the FILES need a home here. Both pointers ride jsonb that already syncs:
--   * the clip on an exercise is `ex.demoVideo`, inside athletes.weeks, so an
--     athlete needs no new read path to see it;
--   * the coach's reusable list is coaches.library_prefs.demoClips, the same
--     blob athlete templates use.
-- So there is no new column in this migration, only a bucket and its policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exercise-demos',
  'exercise-demos',
  false,
  52428800, -- 50 MiB, matching form-checks; the client downscales to 720p30 first
  array['video/webm','video/mp4','video/quicktime']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------- Storage RLS ----------
-- Path convention: <coachId>/<uid>.<ext> — the first folder segment is the
-- owning coach, so every policy gates on (storage.foldername(name))[1].
--
-- Unlike a form check these are shown to EVERY athlete of that coach, but the
-- bucket still isn't public: a demo clip can have a face in it, and a signed
-- URL costs one round trip rather than a permanent open door.

create policy "coach manages own demo clips" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'exercise-demos'
    and (storage.foldername(name))[1] in (
      select id from public.coaches where auth_user_id = (select auth.uid())
    )
  )
  with check (
    bucket_id = 'exercise-demos'
    and (storage.foldername(name))[1] in (
      select id from public.coaches where auth_user_id = (select auth.uid())
    )
  );

-- An athlete reads their own coach's clips, and nobody else's. No delete and no
-- insert: the library is the coach's to curate.
create policy "athlete reads own coach demo clips" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'exercise-demos'
    and (storage.foldername(name))[1] in (
      select a.coach_id from public.athletes a
      where a.auth_user_id = (select auth.uid())
    )
  );
