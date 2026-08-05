-- Card payments (Square), for the monthly memberships the app already grants.
--
-- ============================================================================
-- WHY THESE ARE THEIR OWN TABLES, AND NOT FIELDS ON sessionBank
-- ============================================================================
-- runAutoRenewGrants() runs in the COACH'S BROWSER on every calendar load, and
-- saveTrainer -> upsertAthlete pushes the whole athlete row, session_bank jsonb
-- and all. So anything a webhook wrote into session_bank would be overwritten
-- by the next coach save, with the coach's stale local copy, silently — the
-- same trap that makes direct SQL edits to athlete rows unsafe.
--
-- Therefore: payment state lives here, the client NEVER writes it, and the UI
-- joins it onto a package by month_key at render time. Note the deliberate
-- absence of insert/update/delete policies below — that is not an oversight,
-- it is the mechanism. Only the service-role key (i.e. the Edge Functions) can
-- write, so the only thing that can say "this was paid" is a Square webhook
-- whose HMAC signature verified.
--
-- ============================================================================
-- WHY THE SUBSCRIPTION IS KEYED ON ONE ATHLETE AND NOT ON A "BANK"
-- ============================================================================
-- A couple shares one allowance: two athlete rows, partnerId pointing at each
-- other, and bankMutated() mirroring packages between them. There is no bank
-- id to key on. So the row is keyed on the pair's PRIMARY athlete — the lower
-- of the two ids, which both halves compute identically — and partner_athlete_id
-- names the other half. Reads match on either column, so opening either side of
-- a couple finds the one subscription. Billing per athlete instead would either
-- charge a couple twice or have the two mirrored halves fight over status.

-- ---------- Subscriptions: one row per bank ----------
create table if not exists public.billing_subscriptions (
  athlete_id             text primary key references public.athletes(id) on delete cascade,
  coach_id               text not null references public.coaches(id) on delete cascade,
  partner_athlete_id     text references public.athletes(id) on delete set null,
  -- The MEMBERSHIPS tier id from app.js (e.g. 'single-2'), so the plan the
  -- athlete is paying for and the plan that decides their session count are
  -- the same string in both systems.
  plan_key               text,
  square_customer_id     text,
  square_subscription_id text unique,
  -- none | pending | active | past_due | paused | canceled
  status                 text not null default 'none',
  -- When the first charge failed. The grant gate is a GRACE WINDOW off this,
  -- not off `status` alone: Square retries a failed card over several days, and
  -- locking someone out on day one of a retry punishes the athlete for their
  -- bank's timing.
  past_due_since         timestamptz,
  current_period_end     date,
  canceled_at            timestamptz,
  last_event_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists billing_subs_coach_idx   on public.billing_subscriptions (coach_id);
create index if not exists billing_subs_partner_idx on public.billing_subscriptions (partner_athlete_id);

-- ---------- Payments: one row per charge ----------
-- month_key ('YYYY-MM') is the join to a session package's autoRenewGrant /
-- membershipGrant key. That is what turns the coach's manual "mark collected"
-- tick into something derived.
create table if not exists public.billing_payments (
  id                 uuid primary key default gen_random_uuid(),
  coach_id           text not null references public.coaches(id) on delete cascade,
  athlete_id         text not null references public.athletes(id) on delete cascade,
  month_key          text,
  square_payment_id  text,
  square_invoice_id  text,
  amount_cents       integer,
  currency           text not null default 'USD',
  -- paid | failed | refunded
  status             text not null,
  paid_at            timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists billing_pay_athlete_idx on public.billing_payments (athlete_id, month_key);
create index if not exists billing_pay_coach_idx   on public.billing_payments (coach_id);
-- A payment id can only land once, however many times Square retries the hook.
create unique index if not exists billing_pay_square_id_idx
  on public.billing_payments (square_payment_id)
  where square_payment_id is not null;

-- ---------- Event ledger: webhook idempotency ----------
-- Square retries a webhook until it gets a 2xx, so the same event WILL arrive
-- more than once. The primary key is the whole defence: the handler inserts the
-- event id first and stops on conflict, so a replay cannot grant a second
-- month or double-record a payment.
--
-- The raw payload is deliberately NOT stored. It carries the customer's email
-- and card metadata, and a debugging convenience is not worth standing up a
-- second copy of somebody's payment details in a database that is backed up
-- and replicated. Square's own dashboard keeps the full event.
create table if not exists public.billing_events (
  event_id     text primary key,
  event_type   text,
  athlete_id   text,
  received_at  timestamptz not null default now()
);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments      enable row level security;
alter table public.billing_events        enable row level security;

-- Read-only, both sides. No write policy exists for `authenticated` on any of
-- these three tables, which is what keeps "I paid" a server-only claim.

create policy "athlete reads own subscription" on public.billing_subscriptions
  for select to authenticated
  using (
    athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()))
    or partner_athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()))
  );

create policy "coach reads own athletes subscriptions" on public.billing_subscriptions
  for select to authenticated
  using (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())));

create policy "athlete reads own payments" on public.billing_payments
  for select to authenticated
  using (
    athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()))
    or athlete_id in (
      select s.athlete_id from public.billing_subscriptions s
      where s.partner_athlete_id in (select id from public.athletes where auth_user_id = (select auth.uid()))
    )
  );

create policy "coach reads own athletes payments" on public.billing_payments
  for select to authenticated
  using (coach_id in (select id from public.coaches where auth_user_id = (select auth.uid())));

-- billing_events gets RLS on and NO policies at all: nothing but the service
-- role ever needs to see the webhook ledger.
