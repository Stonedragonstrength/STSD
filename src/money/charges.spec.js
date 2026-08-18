// `athleteOwed` — what one athlete owes, as ONE number — and the other
// billing readers beside it.
//
// Before this, a debt was recorded in two places and nothing added them up:
// packages carry `unpaid` on the bank (the cash side, summed by
// sessionBankSummary().owedAmount) and card charges live in `billing_payments`,
// where unpaidChargeMonths returns MONTHS rather than dollars. A coach reading
// either alone reads half of what he is owed.
//
// The bug this file exists to prevent is the naive fix — adding the two. For a
// membership month they are usually the SAME debt seen twice:
// settleBilledPackages() clears `unpaid` only once a month is PAID, so a month
// that was invoiced and ignored has its charge sitting at "sent" AND its
// package still flagged. Summing both bills the athlete twice on screen, and
// nothing throws — the coach just chases the wrong number.
//
// Also pinned: couples. Kevin and Sarah share one bank and one card, so a
// charge under either half is the bank's debt; counting only rows matching the
// athlete you happen to be looking at under-reports one half to zero.
//
// Ported verbatim from tests/athlete-owed.test.js when the billing readers
// moved out of the IIFE — tier 1 now: a real import of the shipped file. The
// _billing window stays in app.js; the module reads it through the
// STSD.app.billingPayments getter, which this spec fakes per test.
import { describe, it, afterAll } from "vitest";
import assert from "node:assert";
// charges.js load-pulls daysBetweenISO off STSD.training, and stat-field.js
// load-pulls from the modules before it — the same chain its own spec loads.
import "../training/tags.js";
import "../training/library.js";
import "../training/anatomy.js";
import "../training/levels.js";
import "../training/builder.js";
import "../training/stat-field.js";
import "./ledger.js";
import "./charges.js";

const {
  billingRefundedFor, athleteOwed, lastPaymentFor, unpaidChargeMonths, chargeFor,
} = globalThis.STSD.money;

const TODAY = "2026-08-15";

let payments = [];
const prevApp = globalThis.STSD.app;
globalThis.STSD.app = {
  ...prevApp,
  todayISO: () => TODAY,
  dateISO: (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
  ensureSessionBank: (c) => {
    if (!c.sessionBank || typeof c.sessionBank !== "object") c.sessionBank = {};
    if (!Array.isArray(c.sessionBank.packages)) c.sessionBank.packages = [];
    if (!Array.isArray(c.sessionBank.redemptions)) c.sessionBank.redemptions = [];
  },
  billingPayments: () => payments,
};
afterAll(() => { globalThis.STSD.app = prevApp; });

// The seam fake per case: the module must read the CURRENT window each call.
const withPayments = (rows, fn) => { payments = rows; try { return fn(); } finally { payments = []; } };

const pay = (o) => Object.assign(
  { athlete_id: "a", status: "sent", month_key: "2026-07", amount_cents: 85000, created_at: "2026-07-01T10:00:00Z" }, o);
const ath = (o) => Object.assign({ id: "a", name: "A", sessionBank: { packages: [] } }, o);

describe("athleteOwed", () => {
  it("nothing owed reads zero, not NaN", () => withPayments([], () => {
    const r = athleteOwed(ath());
    assert.strictEqual(r.total, 0);
    assert.deepStrictEqual(r.months, []);
  }));

  it("a sent charge is owed, in dollars", () => withPayments([pay({})], () => {
    const r = athleteOwed(ath());
    assert.strictEqual(r.total, 850);
    assert.deepStrictEqual(r.months, ["2026-07"]);
  }));

  it("a PAID charge is not owed", () => withPayments([pay({ status: "paid" })], () => {
    assert.strictEqual(athleteOwed(ath()).total, 0);
  }));

  it("an unpaid package with no charge is owed", () => withPayments([], () => {
    const c = ath({ sessionBank: { packages: [{ price: 170, unpaid: true, addedAt: Date.parse("2026-06-01T12:00:00Z") }] } });
    const r = athleteOwed(c);
    assert.strictEqual(r.total, 170);
    assert.strictEqual(r.fromPackages, 170);
    assert.strictEqual(r.oldestDays, 75, "a package debt ages from the day it was granted");
  }));

  it("THE BUG: a month billed AND still flagged counts ONCE, at the charge's amount", () =>
    withPayments([pay({ month_key: "2026-07", amount_cents: 85000 })], () => {
      // settleBilledPackages only clears `unpaid` on payment, so an ignored
      // invoice leaves both records standing. They are one debt.
      const c = ath({ sessionBank: { packages: [
        { price: 850, unpaid: true, membershipGrant: "2026-07", addedAt: Date.parse("2026-07-01") },
      ] } });
      const r = athleteOwed(c);
      assert.strictEqual(r.total, 850, "the same month was counted twice — the coach chases double what he is owed");
      assert.strictEqual(r.fromCard, 850);
      assert.strictEqual(r.fromPackages, 0, "the package must yield to the charge, which is the figure actually sent");
    }));

  it("a package with no month key never collides, so it adds", () =>
    withPayments([pay({ month_key: "2026-07", amount_cents: 85000 })], () => {
      // A one-off pack is not a membership grant and has no invoice to duplicate.
      const c = ath({ sessionBank: { packages: [
        { price: 850, unpaid: true, membershipGrant: "2026-07" },   // same debt as the charge
        { price: 200, unpaid: true },                                // a separate pack
      ] } });
      assert.strictEqual(athleteOwed(c).total, 1050);
    }));

  it("a couple's debt counts under either half", () =>
    withPayments([pay({ athlete_id: "kevin", month_key: "2026-07", amount_cents: 136000 })], () => {
      // One bank, one card. A charge raised under Kevin is Sarah's bank's debt
      // too, and a sheet opened on her must not read zero.
      const sarah = ath({ id: "sarah", partnerId: "kevin" });
      const kevin = ath({ id: "kevin", partnerId: "sarah" });
      assert.strictEqual(athleteOwed(sarah).total, 1360, "Sarah's sheet reported none of the bank's debt");
      assert.strictEqual(athleteOwed(kevin).total, 1360);
      assert.strictEqual(athleteOwed(sarah).total, athleteOwed(kevin).total,
        "the two halves must agree — see stsd-couples-share-one-bank");
    }));

  it("a re-sent month uses the newest ask, not both", () => withPayments([
    pay({ month_key: "2026-07", amount_cents: 85000, created_at: "2026-07-01T10:00:00Z" }),
    pay({ month_key: "2026-07", amount_cents: 90000, created_at: "2026-07-09T10:00:00Z" }),
  ], () => {
    assert.strictEqual(athleteOwed(ath()).total, 900);
  }));

  it("this month's invoice is owed but NOT overdue", () =>
    withPayments([pay({ month_key: "2026-08", created_at: "2026-08-01T10:00:00Z" })], () => {
      // It was only just sent. Listing it as overdue would have the coach
      // chasing someone on the day he billed them.
      const r = athleteOwed(ath());
      assert.strictEqual(r.total, 850, "still counts toward what is owed");
      assert.deepStrictEqual(r.months, [], "but it is not late");
    }));

  it("oldest age is reported in days", () => withPayments([
    pay({ month_key: "2026-06", created_at: "2026-06-14T10:00:00Z" }),
    pay({ month_key: "2026-07", created_at: "2026-07-14T10:00:00Z" }),
  ], () => {
    const r = athleteOwed(ath());
    assert.strictEqual(r.oldestDays, 62);
    assert.deepStrictEqual(r.months, ["2026-06", "2026-07"]);
  }));

  it("cents survive the sum", () => withPayments([pay({ amount_cents: 76950 })], () => {
    assert.strictEqual(athleteOwed(ath()).total, 769.5);
  }));
});

// ---- New at the port: the readers that never had a test ----

describe("chargeFor: the month's charge for this BANK, not this athlete", () => {
  const rows = [
    pay({ athlete_id: "kevin", month_key: "2026-07", amount_cents: 136000 }),
    pay({ athlete_id: "a", month_key: "2026-06", status: "refunded" }),
  ];
  it("either half of the couple finds it", () => withPayments(rows, () => {
    assert.strictEqual(chargeFor(ath({ id: "sarah", partnerId: "kevin" }), "2026-07")?.amount_cents, 136000);
    assert.strictEqual(chargeFor(ath({ id: "kevin", partnerId: "sarah" }), "2026-07")?.amount_cents, 136000);
  }));
  it("a refunded row is not a charge", () => withPayments(rows, () => {
    assert.strictEqual(chargeFor(ath(), "2026-06"), null);
  }));
  it("no charge is null, not a throw", () => withPayments([], () => {
    assert.strictEqual(chargeFor(ath(), "2026-07"), null);
  }));
});

describe("lastPaymentFor: when money last actually arrived", () => {
  it("the newest PAID row, through the partner, with cash/card named", () => withPayments([
    pay({ athlete_id: "kevin", status: "paid", month_key: "2026-05", amount_cents: 100000, paid_at: "2026-05-02T10:00:00Z", method: "card_on_file" }),
    pay({ athlete_id: "kevin", status: "paid", month_key: "2026-06", amount_cents: 136000, paid_at: "2026-06-02T10:00:00Z", method: "manual" }),
    pay({ athlete_id: "kevin", status: "sent", month_key: "2026-07", amount_cents: 140000 }),
  ], () => {
    const last = lastPaymentFor(ath({ id: "sarah", partnerId: "kevin" }));
    assert.deepStrictEqual(last, { at: "2026-06-02", amount: 1360, method: "cash" });
  }));
  it("never paid is null", () => withPayments([pay({})], () => {
    assert.strictEqual(lastPaymentFor(ath()), null);
  }));
});

describe("unpaidChargeMonths: a NOTICE, never a gate", () => {
  it("past sent months only, oldest first", () => withPayments([
    pay({ month_key: "2026-07" }),
    pay({ month_key: "2026-05" }),
    pay({ month_key: "2026-08" }),          // this month — not late yet
    pay({ month_key: "2026-04", status: "paid" }),
  ], () => {
    assert.deepStrictEqual(unpaidChargeMonths(ath()), ["2026-05", "2026-07"]);
  }));
});

describe("billingRefundedFor: money given back un-settles the month", () => {
  it("sees a refund under either half", () => withPayments([
    pay({ athlete_id: "kevin", month_key: "2026-06", status: "refunded" }),
  ], () => {
    assert.strictEqual(billingRefundedFor(ath({ id: "sarah", partnerId: "kevin" }), "2026-06"), true);
    assert.strictEqual(billingRefundedFor(ath({ id: "sarah", partnerId: "kevin" }), "2026-07"), false);
  }));
});
