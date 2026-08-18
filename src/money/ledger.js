// Extracted from app.js — Phase 3 (Money) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/money/ledger.spec.js imports THIS
// file and reads the namespace, so the shipped code is the tested code.
//
// The ledger core: what a package IS (pkgMonth/pkgOwed/pkgExpired), what a
// bank is worth (bankLedger — the single source of truth for an athlete's
// balance), and the credit-pot arithmetic (CREDIT_CAP_DEFAULT/creditCapOf/
// creditsOn/creditEntries/creditBalance). Real athletes' money: bodies
// verbatim from app.js, zero behavior change. The STATE writers stay in
// app.js (sessionBankSummary, accrueSessionCredits, applyCreditAfterCharge,
// bankMutated and the couple reconcile) — extraction takes the decide half
// and leaves apply.
//
// The one thing this module needs that it cannot see is the clock: app.js
// publishes globalThis.STSD.app.todayISO beside its pull block, and the
// shim below reads it at CALL time — never captured at load, per the
// extraction contract. Only pkgExpired's omitted-month fallback uses it,
// and every caller today passes the month in.
(function () {
  "use strict";

  function todayISO() {
    return globalThis.STSD.app.todayISO();
  }
  // -------- What a package IS --------
  // Three questions get asked about a package all over this file, and each one
  // used to be re-derived inline from a different combination of fields. That
  // is how the package list ended up calling a July allowance "live" in August
  // while the balance card beside it counted zero.
  //
  // Which month's allowance is this, if any? ("" = a pack bought outright.)
  function pkgMonth(p) { return p?.membershipGrant || p?.autoRenewGrant || ""; }
  // Has the coach been paid for it? Purely a note to himself — money happens
  // outside the app. `status: "pending"` is the retired third state, still read
  // here so a row that predates the migration (or arrives from a stale cloud
  // pull) reads as owed rather than silently settled.
  function pkgOwed(p) { return !!p && (!!p.unpaid || p.status === "pending"); }
  // Are its sessions gone? A monthly allowance dies with its month unless the
  // athlete is on rollover; a bought pack never does.
  function pkgExpired(p, todayMonth, rollover) {
    if (rollover) return false;
    const mk = pkgMonth(p);
    return !!mk && mk < (todayMonth || todayISO().slice(0, 7));
  }

  // A monthly allowance is not a bank balance. The athlete pays for access to
  // THIS month; sessions they don't take are gone, the same way a gym month is.
  // Before this, nothing ever expired: a 4-a-month athlete who trained once
  // gained 3 every month forever, and the chip on the day board would read 36
  // by the end of a year — the number looked healthy at exactly the moment the
  // athlete was wasting money and about to quit.
  //
  // Two kinds of package, and the data already told them apart:
  //   • a monthly grant carries the YYYY-MM it was for (membershipGrant from the
  //     manual button, autoRenewGrant from the automatic one) and expires
  //   • a pack bought outright carries neither and never expires
  //
  // Per-athlete `sessionBank.rollover` turns expiry off for the person coming
  // back from injury or away for a month. Off by default: expiry is the policy,
  // rollover is the exception.
  //
  // NOTHING here reads `status`. No money moves through this app — payment is
  // Venmo, cash, a Stripe link, all of it outside — so the app cannot know
  // whether it landed, and a package it has been told to hold back is just a
  // grant the coach has to remember to release by hand. That was the "pending"
  // state, and it was worth zero sessions: an athlete could read "August
  // granted" on one screen and a balance of 0 on the next. Every package is
  // live from the moment it exists; whether the coach has been paid is a note
  // (`unpaid`) that never touches the balance. See pkgOwed().
  function bankLedger(bank, todayMonth, rollover) {
    const packages = bank?.packages || [];
    const redemptions = bank?.redemptions || [];

    const grantByMonth = new Map();
    let packPool = 0;
    packages.forEach((p) => {
      const size = Number(p.size) || 0;
      const mk = pkgMonth(p);
      if (mk) grantByMonth.set(mk, (grantByMonth.get(mk) || 0) + size);
      else packPool += size;
    });

    const usedByMonth = new Map();
    let undated = 0;
    redemptions.forEach((r) => {
      const mk = String(r?.date || "").slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(mk)) usedByMonth.set(mk, (usedByMonth.get(mk) || 0) + 1);
      else undated++;
    });

    let carried = 0;        // allowance surviving a past month (rollover only)
    let expired = 0;        // allowance lost to a month end
    let packUsed = undated; // a use with no date has to come off something real
    // Per month, so the credit accrual can read the SAME arithmetic instead of
    // recomputing "what was left over" beside it and drifting from it.
    const byMonth = new Map();

    const months = new Set([...grantByMonth.keys(), ...usedByMonth.keys()]);
    months.add(todayMonth);
    months.forEach((mk) => {
      const grant = grantByMonth.get(mk) || 0;
      const used = usedByMonth.get(mk) || 0;
      // The month's own allowance is always spent FIRST. Spending a bought pack
      // while an allowance expires beside it would be taking money twice.
      const left = Math.max(0, grant - used);
      packUsed += Math.max(0, used - grant);
      byMonth.set(mk, { grant, used, left, closed: mk < todayMonth });
      if (mk === todayMonth) return;                    // still live
      if (mk > todayMonth) { carried += left; return; } // hasn't happened yet
      if (rollover) carried += left; else expired += left;
    });

    const thisMonthGrant = grantByMonth.get(todayMonth) || 0;
    const thisMonthUsed = usedByMonth.get(todayMonth) || 0;
    const thisMonth = Math.max(0, thisMonthGrant - thisMonthUsed);
    const banked = packPool + carried - packUsed;
    return {
      thisMonth, thisMonthGrant, thisMonthUsed, banked, expired, byMonth,
      remaining: thisMonth + banked,
      granted: [...grantByMonth.values()].reduce((a, b) => a + b, 0) + packPool,
      used: redemptions.length,
    };
  }

  // ================= Credit for unused sessions =================
  //
  // Opt-in, per athlete. When a month closes with allowance left on it, the
  // leftovers become MONEY OFF the next invoice instead of simply expiring.
  //
  // Deliberately not a scheduled job. Nothing in this app runs on a clock —
  // a "6pm on the last day of the month" calculation only happens if the coach
  // has the app open at 6pm on the last day of the month, and silently does not
  // if he doesn't. A month is closed once it is over, so this is worked out
  // lazily the first time anything asks, the same way allowances expire and
  // auto-renew grants land. Idempotent: one earned entry per month, ever.
  //
  // It also cannot be combined with rollover. Rollover means the sessions carry
  // forward, so there is nothing left over to pay back — turning both on would
  // hand the athlete the session AND the money for it.
  //
  // Capped, because this quietly removes the cost of not turning up. A session
  // missed is a slot he held and could have sold; refunding all of it makes
  // no-showing free, which is exactly why "use it or lose it" is the norm. The
  // cap keeps it a goodwill gesture rather than a standing discount.
  const CREDIT_CAP_DEFAULT = 2;
  const creditCapOf = (c) => {
    const n = Number(c?.sessionBank?.creditCap);
    return Number.isFinite(n) && n >= 0 ? n : CREDIT_CAP_DEFAULT;
  };
  const creditsOn = (c) => !!c?.sessionBank?.creditUnused && !c?.sessionBank?.rollover;
  const creditEntries = (c) => (c?.sessionBank?.credits || []);
  // Earned minus spent. Rounded to whole dollars because it lands on an invoice.
  function creditBalance(c) {
    return Math.max(0, Math.round(creditEntries(c).reduce(
      (n, e) => n + (e.kind === "used" ? -(Number(e.amount) || 0) : (Number(e.amount) || 0)), 0)));
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.money = Object.assign(NS.money || {}, {
    pkgMonth, pkgOwed, pkgExpired,
    bankLedger,
    CREDIT_CAP_DEFAULT, creditCapOf, creditsOn, creditEntries, creditBalance,
  });
})();
