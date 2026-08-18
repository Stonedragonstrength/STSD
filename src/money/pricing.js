// Extracted from app.js — Phase 3 (Money) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/money/pricing.spec.js imports THIS
// file and reads the namespace, so the shipped code is the tested code.
//
// The pricing core: what a session costs THIS athlete (athleteSessionRate),
// what a month of a program-only tier costs them (flatMonthlyFor — the
// grandfathering mechanism), and what a package is worth (bankPackagePrice,
// the ONLY thing that should ever price a package). Real athletes' money:
// bodies verbatim from app.js, zero behavior change. money() the formatter
// stays in app.js — locale formatters move as parts, never as strings.
//
// The one thing this module needs that it cannot see is the coach's tier
// table — membershipById resolves owner-edited and retired tiers out of app
// state. app.js publishes it as globalThis.STSD.app.membershipById beside
// its pull block, and the shim below reads it at CALL time — never captured
// at load, per the extraction contract.
(function () {
  "use strict";

  function membershipById(id) {
    return globalThis.STSD.app.membershipById(id);
  }
  // What this month is worth, and how that number was reached. Shown as the
  // working, not just the total, because a coach about to charge somebody
  // should be able to see WHY it says $819 before they send it.
  // A tier that is priced but grants no sessions bills its price FLAT: the
  // coaching is the product, so sessions × rate is $0 and would offer nothing
  // to bill for an athlete who owes $250. Honours a rate the coach set on
  // this athlete's bank.
  //
  // A program-only tier has no sessions to multiply, so `sessionBank.rate` is
  // not a per-session figure there — it is what this person pays a month, full
  // stop. That is how a GRANDFATHERED member works: Cheryl Ray is on Digital at
  // $100 while the tier's list price has since moved to $250. Reading the tier
  // ignored the number the coach had explicitly typed and quietly re-priced her
  // to today's rate.
  //
  // Returns 0 for every ordinary tier, so sessions × rate is untouched.
  // It lives in its own field now (`flatRate`). `rate` is still read as the
  // fallback, deliberately and permanently: every grandfathered member set
  // before the split has their monthly price there, and a cached build still
  // writes it — see the note in ensureSessionBank. New writes go to flatRate.
  function flatMonthlyFor(c, m) {
    if (!m || m.sessions) return 0;
    const flat = Number(c?.sessionBank?.flatRate);
    if (flat > 0) return flat;
    const own = Number(c?.sessionBank?.rate);
    if (own > 0) return own;
    return Number(m.price) || 0;
  }

  function membershipPerSession(m) {
    return m && m.price && m.sessions ? m.price / m.sessions : 0;
  }
  function athleteSessionRate(c) {
    if (!c) return 0;
    const m = membershipById(c.sessionBank?.membership || "");
    // A program-only tier has no sessions, so it has no per-session price, and
    // the number on their bank is a MONTHLY one (see flatMonthlyFor). Returning
    // it here priced a single booked session at a whole month's fee in the
    // Booked-ahead rows, while the day strip beside them priced the same
    // session at $0. bankPackagePrice already routes flat tiers away from here.
    if (m && !m.sessions) return 0;
    const own = Number(c.sessionBank?.rate);
    if (own > 0) return own;
    return membershipPerSession(m);
  }
  // What a month of this membership costs THIS athlete, which is not always the
  // tier's list price: a custom per-session rate on the bank overrides it, and
  // it multiplies by the sessions actually in the package.
  //
  // Every grant used to stamp the tier price flat, so an athlete on a custom
  // rate was billed the list price and the difference was invisible -- the Bill
  // sheet priced them correctly off athleteSessionRate() while Settle showed
  // the tier's number, and the two disagreed.
  //
  // Without a custom rate this returns exactly the tier price, because the
  // fallback rate IS price/sessions. Program-only tiers bill a flat monthly
  // amount and are never multiplied by anything.
  function bankPackagePrice(c, m, size) {
    if (!m) return 0;
    // Program-only: flat, and a rate on the bank IS that flat amount — see
    // flatMonthlyFor. Never multiplied, because there are no sessions.
    if (!m.sessions) return flatMonthlyFor(c, m);
    // A given 0 means zero, and only an ABSENT size falls back to the tier.
    // Treating 0 as "unset" made a coach who typed 0 in the settle sheet get
    // quoted a full month, which is the one number they were trying not to bill.
    const given = Number(size);
    const n = Number.isFinite(given) && given >= 0 ? given : m.sessions;
    // To CENTS, not to whole dollars. Real rates carry half-dollars ($85.50,
    // $67.50), so 85.5 x 9 is $769.50 and rounding that to $770 invents fifty
    // cents. Round once, here, at the precision money actually has.
    return Math.round(athleteSessionRate(c) * n * 100) / 100;
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.money = Object.assign(NS.money || {}, {
    membershipPerSession, athleteSessionRate, flatMonthlyFor, bankPackagePrice,
  });
})();
