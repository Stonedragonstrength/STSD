// Extracted from app.js — Phase 3 (Money) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/money/projection.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// The projection chain: which package a month has (monthPackageOf), which
// tier a BANK runs on (bankMembership — either half of a couple answers),
// what to bill a month for (sessionsInMonth/billSessionsFor), what a bank
// holds (sessionBankSummary — the wrapper every screen should call), what
// the invoice says (monthChargePlan) and Nathan's own forward arithmetic
// (raiseProjection). Real athletes' money: bodies verbatim, zero behavior
// change. raiseTotals and chargeFor stay in app.js — they fold over the
// roster and the _billing session window, which never leaves the IIFE.
//
// App state comes in through the STSD.app getters, at CALL time, never
// captured: todayISO (the clock), membershipById (the owner-edited tier
// table), partnerOf (the roster), ensureSessionBank (the shape guard — a
// transaction boundary that stays in app.js, design doc §4 rule 7).
(function () {
  "use strict";

  function todayISO() {
    return globalThis.STSD.app.todayISO();
  }
  function membershipById(id) {
    return globalThis.STSD.app.membershipById(id);
  }
  function partnerOf(c) {
    return globalThis.STSD.app.partnerOf(c);
  }
  function ensureSessionBank(c) {
    return globalThis.STSD.app.ensureSessionBank(c);
  }

  // From src/money/ledger.js and pricing.js, which index.html loads first
  // (the boot smoke executes the tags in that order, so a reorder fails the
  // suite before it fails a phone). Checked at load so a missing or
  // misordered tag fails HERE, by name, not silently mid-bill.
  const { pkgOwed, bankLedger, creditBalance, athleteSessionRate, flatMonthlyFor } =
    globalThis.STSD?.money || {};
  [["pkgOwed", pkgOwed], ["bankLedger", bankLedger], ["creditBalance", creditBalance],
   ["athleteSessionRate", athleteSessionRate], ["flatMonthlyFor", flatMonthlyFor]
  ].forEach(([name, fn]) => {
    if (typeof fn !== "function") {
      throw new Error(`src/money/ledger.js and pricing.js must load before projection.js (missing ${name})`);
    }
  });
  function monthPackageOf(c, key) {
    return (c?.sessionBank?.packages || [])
      .find((p) => p.membershipGrant === key || p.autoRenewGrant === key) || null;
  }
  // Guard against creating a SECOND package for the month. Deliberately true
  // for an uncollected one too — the answer to money not yet in hand is to go
  // and collect it, never to grant a second allowance beside the first.
  function grantedThisMonth(c, key) { return !!monthPackageOf(c, key); }

  // The tier a bank runs on. A couple's two halves are one bank, so either
  // half's membership answers for both — bankMutated mirrors it, but a row
  // that was linked before the tier was set can still be one-sided.
  function bankMembership(c) {
    if (!c) return null;
    return membershipById(c.sessionBank?.membership)
      || membershipById(partnerOf(c)?.sessionBank?.membership);
  }

  // Sessions actually taken in a given month, off the bank's own redemption
  // log. monthChargePlan answers this for the CURRENT month only (it reads
  // sessionBankSummary, which is anchored to today), and a sheet with a month
  // stepper on it needs the same question answered about any month.
  function sessionsInMonth(c, monthKey) {
    return (c?.sessionBank?.redemptions || [])
      .filter((r) => String(r?.date || "").slice(0, 7) === monthKey).length;
  }
  // What to bill for, in order of how much it knows: what the month's package
  // says was booked against it, what was actually logged, and failing both the
  // tier's own size — a month billed in advance has neither of the first two.
  function billSessionsFor(c, monthKey, membership) {
    const pkg = monthPackageOf(c, monthKey);
    const booked = Number(pkg?.booked);
    const used = sessionsInMonth(c, monthKey);
    const n = Math.max(Number.isFinite(booked) ? booked : 0, used);
    return n || Number(membership?.sessions) || 0;
  }

  function sessionBankSummary(c) {
    ensureSessionBank(c);
    const l = bankLedger(c.sessionBank, todayISO().slice(0, 7), !!c.sessionBank.rollover);
    // Money still to collect, in packages and in dollars. Never "waiting" —
    // the sessions went out the day they were granted, so this is a list of
    // people to chase, not of anything being held back.
    const owed = c.sessionBank.packages.filter(pkgOwed);
    const owedAmount = owed.reduce((n, p) => n + (Number(p.price) || 0), 0);
    return { ...l, owedCount: owed.length, owedAmount };
  }

  function monthChargePlan(c, monthKey) {
    ensureSessionBank(c);
    const rate = athleteSessionRate(c);
    const membership = bankMembership(c);
    // Asked about the month named, not about today. This used to read
    // sessionBankSummary().thisMonthUsed, which is anchored to the current
    // month however far ahead you are looking — so billing September in August
    // proposed August's session count. See billSessionsFor: the month's own
    // booked count, else what was logged in it, else the tier's size.
    const pkg = monthPackageOf(c, monthKey);
    const sessions = billSessionsFor(c, monthKey, membership);
    const allowance = Number(pkg?.size) || Number(membership?.sessions) || 0;
    const flat = flatMonthlyFor(c, membership);
    const gross = flat || Math.round(sessions * rate);
    // Credit for months that closed with sessions unused. Never more than the
    // invoice itself — a credit bigger than the bill would produce a negative
    // charge, and the rest stays on the balance for next time.
    const credit = Math.min(creditBalance(c), gross);
    return {
      sessions, rate, allowance, flat, gross, credit,
      over: allowance ? Math.max(0, sessions - allowance) : 0,
      amount: Math.max(0, gross - credit),
    };
  }
  // The Raise fold's forward look, Nathan's own arithmetic: what this bank
  // BUYS next month minus what is SITTING IN IT today. A missed session stays
  // in the bank, so every miss visibly pushes next month's number down the
  // day it happens — that is the point of the row. The charge button beside
  // it keeps monthChargePlan's exact invoice amount; this is the lens, not
  // the bill.
  //
  // Two readings per bank, and they bracket reality:
  //   projected — sessions − bank today. The HEADLINE, and already the
  //               missed-sessions number: it is what next month is worth if
  //               every remaining session got missed and stayed in the bank.
  //   hitsAll   — they burn the bank before the 1st, so the full buy stands.
  // Every attended session moves the projection up toward the ceiling; the
  // two meet on the 1st. (A third "missed every other session" middle lived
  // here for one evening — Nathan couldn't verify it against anything, and a
  // money figure the owner can't check has no business on the page.)
  // A bank in DEBT (negative) adds to the projection — sessions were
  // delivered unpaid, and next month is where that money comes back.
  function raiseProjection(c, monthKey) {
    const plan = monthChargePlan(c, monthKey);
    const left = sessionBankSummary(c).remaining;
    if (plan.flat) {
      // Program-only: the bank never offsets a flat price.
      return { ...plan, left, net: 0, projected: plan.amount, hitsAll: plan.amount };
    }
    const price = (n) => Math.round(n * plan.rate * 100) / 100;
    return {
      ...plan,
      left,
      net: Math.max(0, plan.sessions - left),
      projected: price(Math.max(0, plan.sessions - left)),
      hitsAll: price(plan.sessions),
    };
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.money = Object.assign(NS.money || {}, {
    monthPackageOf, grantedThisMonth, bankMembership,
    sessionsInMonth, billSessionsFor,
    sessionBankSummary, monthChargePlan, raiseProjection,
  });
})();
