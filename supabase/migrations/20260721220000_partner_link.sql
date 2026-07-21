-- Partner link: two athletes (a couple) share one session bank. The link is
-- symmetric (each row points at the other); the coach app mirrors the bank's
-- money fields onto both rows on every change, so each athlete reads the
-- shared balance from their own RLS-scoped row. No policy changes needed.

alter table public.athletes add column partner_id text;
