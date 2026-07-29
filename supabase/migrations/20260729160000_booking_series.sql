-- Weekly recurring bookings.
--
-- A series is EXPANDED into ordinary booking rows when it is created, rather
-- than stored as a rule that everything else has to learn to read. That keeps
-- one authority for "is this time taken?" — the partial unique index — and it
-- means cancelling one week, moving one week, the athlete's own list, the
-- Google event per session and the auto-redeem walker all keep working with no
-- knowledge that a series exists. The column below is only a handle for
-- "cancel the rest of these" and "add more weeks".
--
-- The cost of expanding is that a series has an end. That is deliberate: an
-- infinite recurrence needs a background job to keep topping it up, and a job
-- that quietly writes appointments to a real calendar is exactly the kind of
-- thing that rots unnoticed. The coach picks a length and extends it.
alter table public.bookings
  add column if not exists series_id text;

-- Partial: only series rows are ever looked up this way, and it is always
-- "the rest of this series from here on", hence start_at in the key.
create index if not exists bookings_series_idx
  on public.bookings (series_id, start_at) where series_id is not null;
