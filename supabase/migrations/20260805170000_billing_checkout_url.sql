-- The payment link itself, so the athlete can pay from inside the app.
--
-- Until now the URL only ever existed in the coach's browser for as long as the
-- sheet was open — he copied it and sent it by text. Storing it means the
-- athlete opens their own Sessions tab and pays, which is the friction this was
-- supposed to remove.
--
-- Safe to expose: billing_payments' select policy already restricts a row to
-- the athlete it belongs to and their coach, and a Square checkout URL is
-- exactly what that athlete is meant to have. It grants nothing else — the page
-- it opens is Square's, and the card never comes back here.
--
-- NOT stored for prediction. The athlete is shown a charge the coach actually
-- raised and never an estimate of one: the amounts get adjusted and discounted
-- by hand, so an app-computed figure would routinely disagree with the real
-- one, and a number that changes under someone is worse than no number.
alter table public.billing_payments
  add column if not exists checkout_url text;
