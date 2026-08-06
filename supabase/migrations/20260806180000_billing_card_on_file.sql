-- A card the athlete has saved, so paying a month costs one tap instead of
-- typing a card number every time.
--
-- These ride billing_subscriptions rather than a new table. That row is already
-- "this athlete's billing relationship" — one per athlete (or per couple, keyed
-- on the primary half), already carrying square_customer_id, already readable by
-- the athlete and their coach. A billing_cards table would duplicate all of it
-- to hold four columns. The row's NAME is a leftover from the subscription
-- design that 87814c8 removed; the columns below are what it actually holds now.
--
-- Note what is NOT stored: no PAN, no expiry, no CVV, nothing that could be used
-- to charge a card anywhere else. square_card_id is an opaque Square handle that
-- only works against this seller account, and brand/last4 exist purely so the
-- athlete can see WHICH card is saved. Card data never reaches this database or
-- the app's own code — the fields are rendered by Square's SDK in Square's
-- iframes, and tokenised in the browser before anything is sent anywhere.
alter table public.billing_subscriptions
  add column if not exists square_card_id text,
  add column if not exists card_brand     text,
  add column if not exists card_last4     text,
  add column if not exists card_saved_at  timestamptz,
  add column if not exists autopay        boolean not null default false;

comment on column public.billing_subscriptions.square_card_id is
  'Square card-on-file id. Opaque, seller-scoped, useless anywhere else.';
comment on column public.billing_subscriptions.autopay is
  'Athlete opted in to being charged without tapping. Off unless they turn it on.';

-- Autopay is meaningless without a card, and a stale `true` left behind after a
-- card is removed is the shape of an unexpected charge. Enforced here rather
-- than trusted to the function, because this is the constraint that stops money
-- moving for someone who has no saved card.
alter table public.billing_subscriptions
  drop constraint if exists billing_autopay_needs_card;
alter table public.billing_subscriptions
  add constraint billing_autopay_needs_card
  check (autopay = false or square_card_id is not null);

-- No new RLS policies on purpose. The table already grants SELECT to the owning
-- athlete and their coach and has NO write policy for anybody — the only writer
-- is an Edge Function holding the service role. An athlete who could write here
-- could write themselves a saved card, or flip autopay on someone else.

-- What a charge was taken from, so a receipt can say "Visa ···4242" and a
-- refund conversation can start from the right place. Nullable: every payment
-- raised before card-on-file existed came from a hosted Square link.
alter table public.billing_payments
  add column if not exists source text;

comment on column public.billing_payments.source is
  'How the money was taken: card_on_file, checkout link, or manual (cash).';
