-- Correction to the billing model shipped earlier today.
--
-- That version assumed a Square SUBSCRIPTION: a fixed amount on a fixed
-- cadence, tied to a plan. That is not how this business bills. Nathan charges
-- by the SESSION, the count moves month to month (somebody on an 8-session
-- membership who trains 9 times is charged for 9), and discounts happen. A
-- fixed recurring amount cannot express any of that, and every month would
-- have needed a manual correction alongside it.
--
-- So the unit of billing here is a MONTH'S CHARGE for a variable amount, sent
-- as a Square-hosted payment link. The app already computes the number — it
-- shows sessions × rate on the income card — and the coach can adjust it
-- before sending, which is where a discount or an extra session lands.
--
-- What that changes here: a charge now exists BEFORE it is paid (the link has
-- been sent and nobody has paid yet), so billing_payments needs a 'sent' state
-- and something to recognise the payment by when it arrives. Square returns an
-- order id when it creates the link, and the payment webhook carries the same
-- order id, so that is the join.

alter table public.billing_payments
  add column if not exists square_order_id text,
  -- What the coach was charging FOR, in their words: "9 sessions · Aug" or
  -- "8 sessions less a £50 goodwill". The amount alone doesn't survive the
  -- question "why was this one different?" three months later.
  add column if not exists note text,
  -- The count this charge was raised for, kept beside the amount so an
  -- adjusted total can still be read back as "9 sessions, discounted".
  add column if not exists sessions integer;

-- The webhook matches an incoming payment to the charge that created it.
create unique index if not exists billing_pay_order_idx
  on public.billing_payments (square_order_id)
  where square_order_id is not null;

-- status now spans: sent -> paid | failed | refunded | canceled.
comment on column public.billing_payments.status is
  'sent (link issued, unpaid) | paid | failed | refunded | canceled';
