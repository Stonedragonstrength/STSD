-- Invoices: turning the charge rows into documents.
--
-- billing_payments already held everything an invoice says — who, which month,
-- how many sessions, how much, what it was for, and whether it has been paid.
-- What it lacked was the two things that make a row a DOCUMENT rather than a
-- record: a number, and the issuer's own details as they stood on the day.
--
-- ============================================================================
-- WHY THE NUMBER IS SERVER-ASSIGNED, AND SEQUENTIAL PER COACH
-- ============================================================================
-- An invoice number is a promise: every invoice has exactly one, no two share
-- one, and the run has no holes. A client-generated number breaks all three the
-- first time two devices raise a charge in the same minute, and this coach runs
-- the app on a phone and a laptop at once. So it comes from a counter in the
-- database, bumped inside the same statement that reads it.
--
-- Not a Postgres SEQUENCE: those are global, and a sequence shared across
-- coaches would number the first coach's invoices 1, 4, 9. The run has to be
-- per coach, which means a row per coach and an atomic upsert-returning.
--
-- ============================================================================
-- WHY THE ISSUER IS COPIED ONTO THE ROW
-- ============================================================================
-- The business name, address and contact on an invoice are what they were the
-- day it was issued. Reading them live off the coach's profile would silently
-- rewrite every invoice ever sent the day he changes his phone number — and an
-- invoice that changes after it was sent is not evidence of anything.
--
-- It also solves the athlete's side for free: they already have select on their
-- own billing_payments rows, so the details ride along with the invoice instead
-- of needing a policy that lets athletes read the coaches table.

-- ---------- The per-coach counter ----------
create table if not exists public.billing_invoice_seq (
  coach_id text primary key references public.coaches(id) on delete cascade,
  next_no  integer not null default 0
);

-- RLS on, no policies at all: nothing but the service role ever touches this.
alter table public.billing_invoice_seq enable row level security;

-- Read-and-bump in ONE statement, so two concurrent charges cannot be handed
-- the same number. The row lock taken by the upsert is what serialises them;
-- a select-then-update would not.
create or replace function public.next_invoice_no(p_coach text)
returns integer
language sql
security definer
set search_path = public
as $$
  insert into public.billing_invoice_seq (coach_id, next_no)
  values (p_coach, 1)
  on conflict (coach_id) do update set next_no = billing_invoice_seq.next_no + 1
  returning next_no;
$$;

-- Service role only. It is reachable through the Edge Functions and nowhere
-- else — a browser that could bump the counter could burn numbers out of the
-- run, which is the one thing the run is not allowed to have.
revoke execute on function public.next_invoice_no(text) from public;
revoke execute on function public.next_invoice_no(text) from anon;
revoke execute on function public.next_invoice_no(text) from authenticated;

-- ---------- What a charge needs to be an invoice ----------
alter table public.billing_payments
  add column if not exists invoice_no integer,
  -- { businessName, contact, address, taxLine, footer } as of the issue date.
  add column if not exists issuer jsonb,
  -- The per-session figure the total was built from. `sessions` and
  -- `amount_cents` were already here, but 9 and $819 do not imply $91 once a
  -- discount has been applied — and an invoice line that cannot show its own
  -- working is the thing people ring up about.
  add column if not exists rate_cents integer,
  -- 'card'   — Square holds the money side; only the webhook may settle it.
  -- 'manual' — an invoice raised with no payment link, for somebody who pays
  --            cash or by transfer. The coach settles it himself, which is a
  --            claim only he is allowed to make (see markInvoicePaid in
  --            square-billing: it refuses any row carrying a Square order id).
  add column if not exists method text;

-- One run per coach, no duplicates in it.
create unique index if not exists billing_pay_invoice_no_idx
  on public.billing_payments (coach_id, invoice_no)
  where invoice_no is not null;

comment on column public.billing_payments.method is
  'card (Square confirms it) | manual (the coach confirms it)';

-- ---------- Backfill ----------
-- Charges raised before invoices existed are still real invoices; they are
-- simply the earliest ones. Numbered oldest first per coach so the run reads in
-- the order the money was actually asked for, with id breaking ties on rows
-- created in the same instant.
with numbered as (
  select id,
         row_number() over (partition by coach_id order by created_at, id) as n
  from public.billing_payments
  where invoice_no is null
)
update public.billing_payments p
set invoice_no = numbered.n
from numbered
where p.id = numbered.id;

-- Existing rows all came from Square.
update public.billing_payments set method = 'card'
where method is null and square_order_id is not null;

-- And the counter picks up from the end of that run rather than from 1, which
-- would hand the next invoice a number that already exists.
insert into public.billing_invoice_seq (coach_id, next_no)
select coach_id, max(invoice_no) from public.billing_payments
where invoice_no is not null
group by coach_id
on conflict (coach_id) do update
  set next_no = greatest(public.billing_invoice_seq.next_no, excluded.next_no);
