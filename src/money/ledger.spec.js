// The monthly-allowance ledger — the single source of truth for what an
// athlete's bank is worth, so every boundary gets an assertion. This decides
// what athletes owe. See stsd memory: remaining = granted − used − expired,
// and every screen that shows one of those numbers must show enough of them
// to add up.
//
// Ported verbatim from tests/session-bank.test.js when the ledger moved out
// of the IIFE — tier 1 now: a real import of the shipped file. That old file
// asserted against a HAND COPY of bankLedger which had already drifted
// structurally (its copy had no byMonth); this spec reads the shipped code,
// so a change reaches the assertions instead of leaving a copy behind.
//
// New at the port: byMonth (the contract accrueSessionCredits reads), the
// package-identity trio (pkgMonth/pkgOwed/pkgExpired — including the
// omitted-month fallback through the STSD.app.todayISO seam, untestable
// before), and the credit-pot arithmetic.
import { describe, it } from "vitest";
import assert from "node:assert";
import "./ledger.js";

const {
  pkgMonth, pkgOwed, pkgExpired, bankLedger,
  CREDIT_CAP_DEFAULT, creditCapOf, creditsOn, creditEntries, creditBalance,
} = globalThis.STSD.money;

const grant = (mk, size) => ({ id: "g" + mk, size, status: "paid", membershipGrant: mk });
const pack = (size) => ({ id: "p" + size, size, status: "paid" });
const uses = (mk, n) => Array.from({ length: n }, (_, i) => ({ id: mk + i, date: `${mk}-1${i}` }));

describe("the case Nathan named: 4/month, uses 1", () => {
  // Six months of a 4-session allowance, one session used each month.
  const b = { packages: [], redemptions: [] };
  ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].forEach((mk) => {
    b.packages.push(grant(mk, 4));
    b.redemptions.push(...uses(mk, 1));
  });
  const off = bankLedger(b, "2026-07", false);
  const on = bankLedger(b, "2026-07", true);
  it("expiring: balance is this month only", () => assert.deepStrictEqual(off.remaining, 3));
  it("expiring: five past months x 3 lost", () => assert.deepStrictEqual(off.expired, 15));
  it("rolling: everything accumulates", () => assert.deepStrictEqual(on.remaining, 18));
  it("rolling: nothing expires", () => assert.deepStrictEqual(on.expired, 0));
  it("granted total is unchanged either way", () => assert.deepStrictEqual([off.granted, on.granted], [24, 24]));
});

describe("allowance is spent before a bought pack", () => {
  const b = { packages: [grant("2026-07", 4), pack(10)], redemptions: uses("2026-07", 3) };
  const r = bankLedger(b, "2026-07", false);
  it("3 of the 4 allowance used", () => assert.deepStrictEqual(r.thisMonth, 1));
  it("the 10-pack is untouched", () => assert.deepStrictEqual(r.banked, 10));
  it("total reads 11", () => assert.deepStrictEqual(r.remaining, 11));
});

describe("overflow past the allowance draws on the pack", () => {
  const b = { packages: [grant("2026-07", 4), pack(10)], redemptions: uses("2026-07", 6) };
  const r = bankLedger(b, "2026-07", false);
  it("allowance emptied, not negative", () => assert.deepStrictEqual(r.thisMonth, 0));
  it("2 came off the pack", () => assert.deepStrictEqual(r.banked, 8));
  it("total reads 8", () => assert.deepStrictEqual(r.remaining, 8));
});

describe("a bought pack NEVER expires", () => {
  const b = { packages: [pack(10), grant("2026-05", 4)], redemptions: [] };
  const r = bankLedger(b, "2026-07", false);
  it("pack survives two months on", () => assert.deepStrictEqual(r.banked, 10));
  it("only the old allowance expired", () => assert.deepStrictEqual(r.expired, 4));
  it("no allowance this month", () => assert.deepStrictEqual(r.thisMonth, 0));
});

describe("over-redeeming goes negative, which is a real debt", () => {
  const b = { packages: [grant("2026-07", 2)], redemptions: uses("2026-07", 5) };
  it("3 past the allowance", () => assert.deepStrictEqual(bankLedger(b, "2026-07", false).remaining, -3));
});

describe("money never gates sessions, whatever the package says", () => {
  // The retired "pending" state, which used to be worth zero. A build that
  // still has one of these in storage must treat it as the live grant it
  // always was — the coach agreed to it, the athlete is training on it, and
  // whether the Venmo has cleared is not something this app can see.
  const held = { id: "x", size: 8, status: "pending", autoRenewGrant: "2026-07" };
  it("a legacy held package still grants", () =>
    assert.deepStrictEqual(bankLedger({ packages: [held], redemptions: [] }, "2026-07", false).remaining, 8));
  // Every shape of the money flag lands on the same balance. This is the whole
  // point of the cleanup: one number, no matter who has paid.
  const shapes = [
    { id: "a", size: 8, status: "pending", autoRenewGrant: "2026-07" },
    { id: "b", size: 8, status: "paid", unpaid: true, autoRenewGrant: "2026-07" },
    { id: "c", size: 8, status: "paid", paidAt: 1, autoRenewGrant: "2026-07" },
  ].map((p) => bankLedger({ packages: [p], redemptions: [] }, "2026-07", false).remaining);
  it("held, unpaid and collected all read 8", () => assert.deepStrictEqual(shapes, [8, 8, 8]));
});

describe("an auto-renewed package is LIVE before the money lands", () => {
  // The bug this replaced: auto-renew filed status "pending", so the athlete's
  // Sessions tab said "August granted" over a balance of 0, and the coach's
  // header called them out of sessions the moment they trained.
  const owed = { id: "ar", size: 8, status: "paid", unpaid: true, autoRenewGrant: "2026-07" };
  const b = { packages: [owed], redemptions: uses("2026-07", 2) };
  const r = bankLedger(b, "2026-07", false);
  it("all 8 count immediately", () => assert.deepStrictEqual(r.thisMonthGrant, 8));
  it("2 used leaves 6", () => assert.deepStrictEqual(r.remaining, 6));
  it("never reads as out of sessions", () => assert.deepStrictEqual(r.remaining <= 0, false));
  it("marking it collected changes nothing", () => {
    // Collecting the money must not change the balance by even one.
    const after = bankLedger(
      { packages: [{ ...owed, unpaid: undefined, paidAt: 1 }], redemptions: uses("2026-07", 2) },
      "2026-07", false);
    assert.deepStrictEqual(after.remaining, r.remaining);
  });
});

describe("an unpaid auto-renewal still expires with its month", () => {
  const owed = { id: "ar", size: 4, status: "paid", unpaid: true, autoRenewGrant: "2026-06" };
  const b = { packages: [owed], redemptions: uses("2026-06", 1) };
  it("gone in July like any allowance", () => assert.deepStrictEqual(bankLedger(b, "2026-07", false).remaining, 0));
  it("and it expired, it didn't vanish", () => assert.deepStrictEqual(bankLedger(b, "2026-07", false).expired, 3));
});

describe("month boundary: last month's leftover is gone on the 1st", () => {
  const b = { packages: [grant("2026-06", 4)], redemptions: uses("2026-06", 1) };
  it("standing in June, 3 left", () => assert.deepStrictEqual(bankLedger(b, "2026-06", false).remaining, 3));
  it("standing in July, 0 left", () => assert.deepStrictEqual(bankLedger(b, "2026-07", false).remaining, 0));
  it("standing in July with rollover, 3", () => assert.deepStrictEqual(bankLedger(b, "2026-07", true).remaining, 3));
});

describe("December to January rollover of the YEAR", () => {
  const b = { packages: [grant("2026-12", 4), grant("2027-01", 4)], redemptions: uses("2026-12", 2) };
  const r = bankLedger(b, "2027-01", false);
  it("January's own 4 are live", () => assert.deepStrictEqual(r.thisMonth, 4));
  it("December's leftover 2 expired", () => assert.deepStrictEqual(r.expired, 2));
  it("no accidental carry across the year", () => assert.deepStrictEqual(r.remaining, 4));
});

describe("a past month over-redeemed is a debt, never negative expiry", () => {
  // Over-use eats into the pack pool (a real debt); it must not create
  // negative `expired`, which would quietly inflate the identity the balance
  // card adds up from.
  const b = { packages: [grant("2026-06", 2)], redemptions: uses("2026-06", 5) };
  const r = bankLedger(b, "2026-07", false);
  it("nothing expired — it was all used and then some", () => assert.deepStrictEqual(r.expired, 0));
  it("the overflow is a debt on the bank", () => assert.deepStrictEqual(r.remaining, -3));
});

describe("an undated redemption still costs something", () => {
  const b = { packages: [pack(5)], redemptions: [{ id: "u1" }, { id: "u2", date: "" }] };
  it("both come off the pack", () => assert.deepStrictEqual(bankLedger(b, "2026-07", false).banked, 3));
});

describe("a session redeemed for a FUTURE month doesn't expire early", () => {
  const b = { packages: [grant("2026-08", 4)], redemptions: uses("2026-08", 1) };
  const r = bankLedger(b, "2026-07", false);
  it("next month's leftover 3 is carried, not expired", () => assert.deepStrictEqual(r.remaining, 3));
  it("nothing expired", () => assert.deepStrictEqual(r.expired, 0));
});

describe("an athlete with no bank at all", () => {
  it("empty is zero", () => assert.deepStrictEqual(bankLedger({ packages: [], redemptions: [] }, "2026-07", false).remaining, 0));
  it("undefined bank is zero", () => assert.deepStrictEqual(bankLedger(undefined, "2026-07", false).remaining, 0));
});

describe("the balance card has to ADD UP: granted − used − expired", () => {
  // The card shows these numbers side by side, so if this identity ever breaks
  // the coach is looking at a screen that contradicts itself. It is what the
  // old card got wrong: it showed all-time "purchased" against a this-month
  // balance and never showed `expired`, so the arithmetic was unfollowable.
  const cases = {
    "six months, one used each": (() => {
      const b = { packages: [], redemptions: [] };
      ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].forEach((mk) => {
        b.packages.push(grant(mk, 4));
        b.redemptions.push(...uses(mk, 1));
      });
      return [b, "2026-07", false];
    })(),
    "allowance plus an untouched pack": [{ packages: [grant("2026-07", 4), pack(10)], redemptions: uses("2026-07", 3) }, "2026-07", false],
    "overflow draws on the pack": [{ packages: [grant("2026-07", 4), pack(10)], redemptions: uses("2026-07", 6) }, "2026-07", false],
    "old allowance gone, pack survives": [{ packages: [pack(10), grant("2026-05", 4)], redemptions: [] }, "2026-07", false],
    "over-redeemed into debt": [{ packages: [grant("2026-07", 2)], redemptions: uses("2026-07", 5) }, "2026-07", false],
    "across the year boundary": [{ packages: [grant("2026-12", 4), grant("2027-01", 4)], redemptions: uses("2026-12", 2) }, "2027-01", false],
    "a redemption with no date": [{ packages: [pack(5)], redemptions: [{ id: "u1" }, { id: "u2", date: "" }] }, "2026-07", false],
    "booked into next month": [{ packages: [grant("2026-08", 4)], redemptions: uses("2026-08", 1) }, "2026-07", false],
    "a PAST month over-redeemed": [{ packages: [grant("2026-06", 2)], redemptions: uses("2026-06", 5) }, "2026-07", false],
    "rollover keeps everything": [{ packages: [grant("2026-05", 4), grant("2026-07", 4)], redemptions: uses("2026-05", 1) }, "2026-07", true],
  };
  Object.entries(cases).forEach(([name, [b, mk, ro]]) => {
    it(`${name}: remaining = granted − used − expired`, () => {
      const r = bankLedger(b, mk, ro);
      assert.deepStrictEqual(r.remaining, r.granted - r.used - r.expired);
    });
  });
});

// ---- New at the port ----

describe("byMonth: the per-month view the credit accrual reads", () => {
  // accrueSessionCredits walks byMonth and credits v.left for v.closed months.
  // The old test file's hand copy of bankLedger didn't even HAVE byMonth —
  // this contract had no assertion anywhere.
  const b = { packages: [grant("2026-06", 4), grant("2026-07", 4)], redemptions: [...uses("2026-06", 1), ...uses("2026-08", 1)] };
  const r = bankLedger(b, "2026-07", false);
  it("a closed month carries its leftovers and closed:true", () =>
    assert.deepStrictEqual(r.byMonth.get("2026-06"), { grant: 4, used: 1, left: 3, closed: true }));
  it("today's month is present and NOT closed", () =>
    assert.deepStrictEqual(r.byMonth.get("2026-07"), { grant: 4, used: 0, left: 4, closed: false }));
  it("a future month is not closed either", () =>
    assert.deepStrictEqual(r.byMonth.get("2026-08").closed, false));
  it("today's row exists even on an empty bank", () =>
    assert.deepStrictEqual(bankLedger({ packages: [], redemptions: [] }, "2026-07", false).byMonth.get("2026-07"),
      { grant: 0, used: 0, left: 0, closed: false }));
});

describe("what a package IS: pkgMonth / pkgOwed / pkgExpired", () => {
  it("a manual grant's month", () => assert.deepStrictEqual(pkgMonth({ membershipGrant: "2026-07" }), "2026-07"));
  it("an auto-renew grant's month", () => assert.deepStrictEqual(pkgMonth({ autoRenewGrant: "2026-06" }), "2026-06"));
  it("a bought pack has no month", () => assert.deepStrictEqual(pkgMonth({ id: "p", size: 10 }), ""));
  it("no package, no month", () => assert.deepStrictEqual(pkgMonth(null), ""));

  it("unpaid is owed", () => assert.deepStrictEqual(pkgOwed({ unpaid: true }), true));
  it("the retired 'pending' still reads as owed, never silently settled", () =>
    assert.deepStrictEqual(pkgOwed({ status: "pending" }), true));
  it("collected is not owed", () => assert.deepStrictEqual(pkgOwed({ status: "paid", paidAt: 1 }), false));
  it("no package is not owed", () => assert.deepStrictEqual(pkgOwed(null), false));

  it("a monthly allowance dies with its month", () =>
    assert.deepStrictEqual(pkgExpired(grant("2026-06", 4), "2026-07", false), true));
  it("its own month is alive", () =>
    assert.deepStrictEqual(pkgExpired(grant("2026-07", 4), "2026-07", false), false));
  it("rollover turns expiry off", () =>
    assert.deepStrictEqual(pkgExpired(grant("2026-06", 4), "2026-07", true), false));
  it("a bought pack never expires", () =>
    assert.deepStrictEqual(pkgExpired(pack(10), "2027-01", false), false));
  it("an omitted month falls back to the clock through the STSD.app seam", () => {
    // Untestable before the extraction: todayISO was a free name inside the
    // IIFE. The module reads it off STSD.app at CALL time, so a spec can be
    // any day it likes.
    const prev = globalThis.STSD.app;
    globalThis.STSD.app = { ...prev, todayISO: () => "2026-08-18" };
    try {
      assert.deepStrictEqual(pkgExpired(grant("2026-07", 4), "", false), true);
      assert.deepStrictEqual(pkgExpired(grant("2026-08", 4), "", false), false);
    } finally {
      globalThis.STSD.app = prev;
    }
  });
});

describe("the credit pot arithmetic", () => {
  it("the default cap is a gesture, not a standing discount", () =>
    assert.deepStrictEqual(creditCapOf({ sessionBank: {} }), CREDIT_CAP_DEFAULT));
  it("a typed cap stands", () => assert.deepStrictEqual(creditCapOf({ sessionBank: { creditCap: 5 } }), 5));
  it("a typed ZERO means zero, only absence falls back", () =>
    assert.deepStrictEqual(creditCapOf({ sessionBank: { creditCap: 0 } }), 0));
  it("garbage falls back to the default", () =>
    assert.deepStrictEqual([creditCapOf({ sessionBank: { creditCap: -1 } }), creditCapOf({ sessionBank: { creditCap: "x" } })],
      [CREDIT_CAP_DEFAULT, CREDIT_CAP_DEFAULT]));

  it("credits need the toggle", () => assert.deepStrictEqual(creditsOn({ sessionBank: {} }), false));
  it("the toggle turns them on", () => assert.deepStrictEqual(creditsOn({ sessionBank: { creditUnused: true } }), true));
  it("rollover wins — never both", () =>
    assert.deepStrictEqual(creditsOn({ sessionBank: { creditUnused: true, rollover: true } }), false));

  it("no entries reads as an empty list, not a throw", () =>
    assert.deepStrictEqual(creditEntries({}), []));

  it("balance is earned minus used", () =>
    assert.deepStrictEqual(creditBalance({ sessionBank: { credits: [
      { id: "e1", kind: "earned", amount: 200 },
      { id: "u1", kind: "used", amount: 150 },
    ] } }), 50));
  it("a balance never goes below zero", () =>
    assert.deepStrictEqual(creditBalance({ sessionBank: { credits: [
      { id: "u1", kind: "used", amount: 150 },
    ] } }), 0));
  it("rounded to whole dollars, because it lands on an invoice", () =>
    assert.deepStrictEqual(creditBalance({ sessionBank: { credits: [
      { id: "e1", kind: "earned", amount: 100.4 },
    ] } }), 100));
});
