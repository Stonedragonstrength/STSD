-- Free sessions: birthdays and referrals.
--
-- Both rewards are ordinary rows inside the existing `session_bank` jsonb — a
-- package of size 1 at price 0 with no month key, which bankLedger already
-- treats as a pack that never expires and is spent only after the month's paid
-- allowance. So nothing here stores a reward. These three columns are only the
-- inputs the grant passes read.

-- The date the birthday session fires on, and the source of truth for age.
-- `age` stays because a cached PWA on the previous build reads it and has
-- never heard of birthdays; the client writes both, deriving age from this.
-- Nullable forever: an athlete who would rather not give the date just never
-- gets the gift, which is a better trade than making it mandatory.
alter table public.athletes
  add column if not exists birthday date;

-- Reusable, unlike invite_code, which claims one account and is spent. This
-- identifies the referrer and gets handed to several people, so it is not
-- unique-constrained against invite_code and lives in its own column.
alter table public.athletes
  add column if not exists referral_code text;

-- Who brought this athlete in. Set by the coach on the add-athlete form, since
-- the coach creates every account — there is no athlete-facing code entry, so
-- this can never point at a typo.
--
-- ON DELETE SET NULL rather than CASCADE: removing the referrer must not
-- delete the person they referred. The reward package already granted is a row
-- in the referrer's own session_bank and is unaffected either way.
alter table public.athletes
  add column if not exists referred_by text
  references public.athletes(id) on delete set null;

-- The referral scan walks every athlete looking for a referrer, once per
-- calendar load.
create index if not exists athletes_referred_by_idx
  on public.athletes(referred_by) where referred_by is not null;
