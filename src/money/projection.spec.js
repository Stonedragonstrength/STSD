// The projection chain — from a bank to next month's number.
//
// The contract under test (Nathan's arithmetic, settled 2026-08-08 after one
// evening of iteration — a third "missed every other session" middle reading
// was tried and removed the same night, because he couldn't verify it):
//   left      = the bank RIGHT NOW (sessionBankSummary().remaining; may be
//               negative — sessions delivered unpaid)
//   projected = max(0, sessions − left) × rate
//               THE HEADLINE, and already the missed-sessions read: what next
//               month is worth if everything still in the bank stays there.
//   hitsAll   = sessions × rate — the ceiling; bank burned by the 1st.
//   Flat (program-only) tiers ignore the bank in both readings.
//   Both read the live bank: every attended session moves the projection up,
//   and the two meet on the 1st.
//
// Ported from tests/raise-projection.test.js when the chain moved out of the
// IIFE — tier 1 now, and STRONGER: the old file re-stated the formula as a
// local copy and fed it (sessions, rate, left) directly; this spec runs the
// REAL raiseProjection over real banks, so billSessionsFor, monthChargePlan,
// sessionBankSummary and the ledger all stand behind every number.
//
// App state comes in through the STSD.app seams, faked here the way app.js
// publishes them: the clock, the tier table, the roster, the shape guard.
import { describe, it, afterAll } from "vitest";
import assert from "node:assert";
import "./ledger.js";
import "./pricing.js";
import "./projection.js";

const {
  monthPackageOf, grantedThisMonth, bankMembership,
  sessionsInMonth, billSessionsFor,
  sessionBankSummary, monthChargePlan, raiseProjection,
} = globalThis.STSD.money;

// Standing on 2026-08-18, billing September — his real shape: the month is
// billed in advance, so the billed month has no redemptions yet.
const TODAY = "2026-08-18";
const THIS_MONTH = "2026-08";
const BILL_MONTH = "2026-09";

const MEMBERSHIPS = [
  { id: "s4", sessions: 4, price: 280 },
  { id: "s9", sessions: 9, price: 769.5 },
  { id: "s13", sessions: 13, price: 910 },
  { id: "s16", sessions: 16, price: 1120 },
  { id: "digital", sessions: 0, price: 250 },
];
const membershipById = (id) => MEMBERSHIPS.find((m) => m.id === id) || null;

const roster = [];
const partnerOf = (c) => (c?.partnerId && roster.find((x) => x.id === c.partnerId)) || null;

// Published at MODULE scope, not in beforeAll: describe-scope fixtures below
// call the chain at collection time, which runs before any hook.
const prevApp = globalThis.STSD.app;
globalThis.STSD.app = {
  ...prevApp,
  todayISO: () => TODAY,
  membershipById,
  partnerOf,
  ensureSessionBank: (c) => {
    if (!c.sessionBank || typeof c.sessionBank !== "object") c.sessionBank = {};
    if (!Array.isArray(c.sessionBank.packages)) c.sessionBank.packages = [];
    if (!Array.isArray(c.sessionBank.redemptions)) c.sessionBank.redemptions = [];
  },
};
afterAll(() => { globalThis.STSD.app = prevApp; });

// A bank standing at `left` today: one current-month grant of that size,
// nothing used. Debt (negative left) is redemptions with nothing granted —
// sessions delivered unpaid.
const holding = (left) => left >= 0
  ? { packages: left ? [{ id: "g", size: left, membershipGrant: THIS_MONTH }] : [], redemptions: [] }
  : { packages: [], redemptions: Array.from({ length: -left }, (_, i) => ({ id: "r" + i, date: `${THIS_MONTH}-1${i}` })) };
const athlete = (tier, rate, left, extra) => ({
  id: "a", sessionBank: { membership: tier, rate, ...holding(left), ...extra },
});

describe("buying minus holding, the row figure", () => {
  // Elise-shaped: buying 13 at $70, holding 3.
  const r = raiseProjection(athlete("s13", 70, 3), BILL_MONTH);
  it("projected is 10 × $70", () => assert.deepStrictEqual([r.projected, r.net], [700, 10]));
  it("ceiling is the full buy", () => assert.deepStrictEqual(r.hitsAll, 910));
});

describe("the projection climbs as the bank burns", () => {
  const day5 = raiseProjection(athlete("s16", 70, 8), BILL_MONTH);
  const day20 = raiseProjection(athlete("s16", 70, 2), BILL_MONTH);
  const day31 = raiseProjection(athlete("s16", 70, 0), BILL_MONTH);
  it("mid-month it sits under the ceiling", () =>
    assert.deepStrictEqual([day5.projected, day5.projected < day5.hitsAll], [560, true]));
  it("it climbs with every attended session", () =>
    assert.deepStrictEqual([day20.projected, day20.projected > day5.projected], [980, true]));
  it("on the 1st the two readings meet", () =>
    assert.deepStrictEqual([day31.projected, day31.projected === day31.hitsAll], [1120, true]));
});

describe("a bank bigger than the buy floors at zero", () => {
  const r = raiseProjection(athlete("s4", 70, 9), BILL_MONTH);
  it("projected is $0, never negative", () => assert.deepStrictEqual(r.projected, 0));
  it("and so is the session count under it", () => assert.deepStrictEqual(r.net, 0));
  it("ceiling still the full buy", () => assert.deepStrictEqual(r.hitsAll, 280));
});

describe("debt adds to the projection, never the ceiling", () => {
  const r = raiseProjection(athlete("s13", 70, -2), BILL_MONTH);
  it("the bank reads negative", () => assert.deepStrictEqual(r.left, -2));
  it("projected recovers the debt", () => assert.deepStrictEqual(r.projected, 1050));
  it("ceiling is untouched by debt", () => assert.deepStrictEqual(r.hitsAll, 910));
});

describe("program-only stays flat in both", () => {
  const r = raiseProjection(athlete("digital", 0, 6, { flatRate: 250 }), BILL_MONTH);
  it("the bank never offsets a flat price", () =>
    assert.deepStrictEqual([r.projected, r.hitsAll, r.net], [250, 250, 0]));
});

describe("half-dollar rates keep their cents", () => {
  const r = raiseProjection(athlete("s9", 85.5, 2), BILL_MONTH);
  it("7 × $85.50 is exact", () => assert.deepStrictEqual(r.projected, 598.5));
  it("9 × $85.50 is exact", () => assert.deepStrictEqual(r.hitsAll, 769.5));
});

// ---- New at the port: the chain the old copy never touched ----

describe("billSessionsFor: what to bill, in order of how much it knows", () => {
  const m = membershipById("s13");
  it("nothing known falls back to the tier's size", () =>
    assert.deepStrictEqual(billSessionsFor(athlete("s13", 70, 0), BILL_MONTH, m), 13));
  it("the month's package remembers what was booked against it", () => {
    const c = athlete("s13", 70, 0);
    c.sessionBank.packages.push({ id: "p9", size: 13, booked: 9, membershipGrant: BILL_MONTH });
    assert.deepStrictEqual(billSessionsFor(c, BILL_MONTH, m), 9);
  });
  it("what was actually logged beats a lower booked count", () => {
    const c = athlete("s13", 70, 0);
    c.sessionBank.packages.push({ id: "p2", size: 13, booked: 2, membershipGrant: BILL_MONTH });
    c.sessionBank.redemptions.push(...[1, 2, 3].map((i) => ({ id: "u" + i, date: `${BILL_MONTH}-0${i}` })));
    assert.deepStrictEqual(billSessionsFor(c, BILL_MONTH, m), 3);
  });
  it("asked about the month NAMED, not about today (the September-in-August bug)", () => {
    // Redemptions this month must not leak into next month's bill.
    const c = athlete("s13", 70, 0);
    c.sessionBank.redemptions.push({ id: "u1", date: `${THIS_MONTH}-02` });
    assert.deepStrictEqual(sessionsInMonth(c, BILL_MONTH), 0);
    assert.deepStrictEqual(billSessionsFor(c, BILL_MONTH, m), 13);
  });
});

describe("monthChargePlan: the invoice", () => {
  it("gross is sessions × rate, amount is gross minus credit, floored at zero", () => {
    const c = athlete("s13", 70, 0, { creditUnused: true, credits: [{ id: "e", kind: "earned", amount: 200 }] });
    const plan = monthChargePlan(c, BILL_MONTH);
    assert.deepStrictEqual([plan.gross, plan.credit, plan.amount], [910, 200, 710]);
  });
  it("credit never exceeds the invoice — the rest stays on the balance", () => {
    const c = athlete("s4", 70, 0, { creditUnused: true, credits: [{ id: "e", kind: "earned", amount: 999 }] });
    const plan = monthChargePlan(c, BILL_MONTH);
    assert.deepStrictEqual([plan.gross, plan.credit, plan.amount], [280, 280, 0]);
  });
  it("over is what runs past the allowance — the PACKAGE's, not the tier's", () => {
    // A coach-edited size (sizeSetBy) makes the month's package the authority.
    const c = athlete("s4", 70, 0);
    c.sessionBank.packages.push({ id: "p", size: 5, booked: 6, membershipGrant: BILL_MONTH });
    const plan = monthChargePlan(c, BILL_MONTH);
    assert.deepStrictEqual([plan.sessions, plan.allowance, plan.over], [6, 5, 1]);
  });
  it("a flat tier bills flat, sessions × rate untouched elsewhere", () => {
    const plan = monthChargePlan(athlete("digital", 0, 0, { flatRate: 175 }), BILL_MONTH);
    assert.deepStrictEqual([plan.flat, plan.gross, plan.amount], [175, 175, 175]);
  });
});

describe("bankMembership: either half of a couple answers for the bank", () => {
  afterAll(() => { roster.length = 0; });
  it("a row linked before the tier was set is still on the bank's tier", () => {
    roster.length = 0;
    const a = { id: "a", partnerId: "b", sessionBank: { packages: [], redemptions: [] } };
    const b = { id: "b", partnerId: "a", sessionBank: { membership: "s13", packages: [], redemptions: [] } };
    roster.push(a, b);
    assert.deepStrictEqual(bankMembership(a)?.id, "s13");
  });
  it("no tier anywhere is null, not a throw", () => {
    roster.length = 0;
    assert.deepStrictEqual(bankMembership({ id: "x", sessionBank: {} }), null);
  });
});

describe("monthPackageOf / grantedThisMonth", () => {
  const c = athlete("s13", 70, 0);
  c.sessionBank.packages.push({ id: "ar", size: 13, autoRenewGrant: BILL_MONTH, unpaid: true });
  it("finds a grant by either route", () =>
    assert.deepStrictEqual(monthPackageOf(c, BILL_MONTH)?.id, "ar"));
  it("an UNCOLLECTED month still counts as granted — collect it, never re-grant", () =>
    assert.deepStrictEqual(grantedThisMonth(c, BILL_MONTH), true));
  it("a month with nothing is not granted", () =>
    assert.deepStrictEqual(grantedThisMonth(c, "2026-10"), false));
});

describe("sessionBankSummary: the ledger plus the chase list", () => {
  it("owed counts packages and sums their STAMPED prices", () => {
    const c = athlete("s13", 70, 3);
    c.sessionBank.packages.push(
      { id: "o1", size: 13, price: 910, unpaid: true, membershipGrant: BILL_MONTH },
      { id: "o2", size: 2, price: 170, status: "pending" },
    );
    const sum = sessionBankSummary(c);
    assert.deepStrictEqual([sum.owedCount, sum.owedAmount], [2, 1080]);
  });
  it("carries the ledger through — remaining is the bank today", () =>
    assert.deepStrictEqual(sessionBankSummary(athlete("s13", 70, 3)).remaining, 3));
  it("and it hands the bank's rollover flag to the ledger", () => {
    const c = athlete("s13", 70, 0, { rollover: true });
    c.sessionBank.packages.push({ id: "old", size: 3, membershipGrant: "2026-06" });
    assert.deepStrictEqual(sessionBankSummary(c).remaining, 3, "a rolling bank lost its carry");
  });
});
