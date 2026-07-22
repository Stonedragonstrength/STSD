-- Athlete-local UI state that must survive the cloud-progress pull on each open
-- (previously kept only in localStorage, so a cloud pull reset it):
--   dismissed_bulletins: { <bulletinId>: true } bulletins the athlete cleared
--   seen_messages:       { <messageId>: true }  coach messages already seen
alter table public.progress
  add column if not exists dismissed_bulletins jsonb not null default '{}'::jsonb,
  add column if not exists seen_messages jsonb not null default '{}'::jsonb;
