// What a month of a membership costs a given athlete.
//
// This earns a test because it decides what athletes are asked to pay. A custom
// per-session rate lives on the bank and overrides the tier's list price, and it
// has to multiply by the sessions in the package. Every grant used to stamp the
// tier price flat, so an athlete on a custom rate was quoted the list price and
// nothing on screen said otherwise — the Bill sheet priced them off the custom
// rate while Settle showed the tier's number, and the two silently disagreed.
//
// The case that matters most is the boring one: an athlete with NO custom rate
// must still come out at exactly the tier price. The fallback rate is
// price/sessions, so the multiply has to be an identity for them, or this fix
// would have quietly re-priced the whole roster.
//
// Ported verbatim from tests/package-price.test.js when the pricing core moved
// out of the IIFE — tier 1 now: a real import of the shipped file. The old
// file's hand copies had DRIFTED: its athleteSessionRate lacked the
// program-only guard and its flatMonthlyFor never read flatRate. The module
// resolves tiers through the STSD.app.membershipById seam, so the spec
// publishes a fixture table there — at call time, like the app does.
import { describe, it, beforeAll, afterAll } from "vitest";
import assert from "node:assert";
import "./pricing.js";

const {
  membershipPerSession, athleteSessionRate, flatMonthlyFor, bankPackagePrice,
} = globalThis.STSD.money;

const MEMBERSHIPS = [
  { id: "single-2", cat: "Single Sessions", perWeek: 2, sessions: 8, price: 725 },
  { id: "single-3", cat: "Single Sessions", perWeek: 3, sessions: 12, price: 1020 },
  { id: "single-4", cat: "Single Sessions", perWeek: 4, sessions: 16, price: 1320 },
  { id: "couples-2", cat: "Couples Sessions", perWeek: 2, sessions: 8, price: 1040 },
  { id: "digital", cat: "Monthly Memberships", sessions: 0, price: 250 },
  { id: "no-session", cat: "Monthly Memberships", sessions: 0 },
];
const membershipById = (id) => MEMBERSHIPS.find((m) => m.id === id) || null;

let prevApp;
beforeAll(() => {
  prevApp = globalThis.STSD.app;
  globalThis.STSD.app = { ...prevApp, membershipById };
});
afterAll(() => { globalThis.STSD.app = prevApp; });

const athlete = (membership, rate) => ({ sessionBank: { membership, ...(rate === undefined ? {} : { rate }) } });
const eq = (what, fn, want) => it(what, () => assert.deepStrictEqual(fn(), want));

describe("no custom rate — must be EXACTLY the tier price", () => {
  // The regression guard. If the multiply is not an identity here, this "fix"
  // silently re-prices every athlete who never had a custom rate.
  eq("8-session tier", () => bankPackagePrice(athlete("single-2"), membershipById("single-2"), 8), 725);
  eq("12-session tier", () => bankPackagePrice(athlete("single-3"), membershipById("single-3"), 12), 1020);
  eq("couples tier", () => bankPackagePrice(athlete("couples-2"), membershipById("couples-2"), 8), 1040);
  // 725/8 = 90.625 — a rate that does not divide evenly still has to round back.
  eq("uneven per-session rate rounds back to the tier price",
    () => bankPackagePrice(athlete("single-2"), membershipById("single-2"), 8), 725);
  eq("rate of 0 is not a custom rate",
    () => bankPackagePrice(athlete("single-2", 0), membershipById("single-2"), 8), 725);
  eq("missing sessionBank falls back to the tier",
    () => bankPackagePrice({}, membershipById("single-2"), 8), 0);
});

describe("custom rate overrides the tier and multiplies", () => {
  eq("$80 × 8", () => bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), 8), 640);
  eq("$80 × 12", () => bankPackagePrice(athlete("single-3", 80), membershipById("single-3"), 12), 960);
  eq("$100 × 8 beats the $725 list price",
    () => bankPackagePrice(athlete("single-2", 100), membershipById("single-2"), 8), 800);
  // The bug as reported: a custom rate was ignored and the list price billed.
  eq("a custom rate is never the tier price by accident",
    () => bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), 8) === 725, false);
  eq("a whole-dollar product stays whole",
    () => bankPackagePrice(athlete("single-2", 90.5), membershipById("single-2"), 8), 724);
  // The reported bug: $85.50 x 9 is $769.50, and rounding it to $770 invents
  // fifty cents on an invoice. Half-dollar rates are the norm here, not an edge.
  eq("half-dollar rate keeps its cents",
    () => bankPackagePrice(athlete("single-3", 85.5), membershipById("single-3"), 9), 769.5);
  eq("$67.50 for a single session",
    () => bankPackagePrice(athlete("single-4", 67.5), membershipById("single-4"), 1), 67.5);
  eq("half-dollar rate x even count is exact",
    () => bankPackagePrice(athlete("single-2", 85.5), membershipById("single-2"), 8), 684);
});

describe("priced by the PACKAGE's size, not the tier's", () => {
  // A package keeps the size it was granted with; the tier can change under it.
  eq("half a package at a custom rate",
    () => bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), 4), 320);
  eq("a bigger package than the tier",
    () => bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), 20), 1600);
  eq("absent size falls back to the tier's sessions",
    () => bankPackagePrice(athlete("single-2", 80), membershipById("single-2")), 640);
  // A typed 0 is an answer, not a missing value. Falling back here quoted a full
  // month to a coach who had just said "charge them for none of it".
  eq("an explicit 0 prices at nothing",
    () => bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), 0), 0);
  eq("a junk size still falls back rather than pricing at nothing",
    () => bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), "abc"), 640);
  eq("a negative size falls back rather than crediting anyone",
    () => bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), -3), 640);
});

describe("program-only tiers are flat and never multiplied", () => {
  eq("digital membership is its monthly price",
    () => bankPackagePrice(athlete("digital"), membershipById("digital"), 0), 250);
  // A session rate must not turn a flat plan into rate × 0 — but it is not
  // ignored either. On a program-only tier there is nothing to multiply, so the
  // number the coach typed IS the monthly amount. This is how a grandfathered
  // member keeps their old price when the tier's list price moves: Cheryl Ray is
  // on Digital at $100 against a $250 list.
  eq("a custom rate does not zero a flat plan",
    () => bankPackagePrice(athlete("digital", 80), membershipById("digital"), 8) > 0, true);
  eq("a custom rate IS the flat monthly amount",
    () => bankPackagePrice(athlete("digital", 100), membershipById("digital"), 0), 100);
  eq("grandfathered rate beats the tier's list price",
    () => bankPackagePrice(athlete("digital", 100), membershipById("digital"), 8), 100);
  eq("no custom rate falls back to the tier's flat price",
    () => bankPackagePrice(athlete("digital"), membershipById("digital"), 0), 250);
  eq("a rate on a no-price tier is still the amount",
    () => bankPackagePrice(athlete("no-session", 75), membershipById("no-session"), 0), 75);
  eq("no-session no-price tier is 0",
    () => bankPackagePrice(athlete("no-session"), membershipById("no-session"), 0), 0);
  eq("no membership at all is 0", () => bankPackagePrice(athlete("single-2", 80), null, 8), 0);
});

// ---- New at the port: the branches the old file's drifted copies missed ----

describe("membershipPerSession", () => {
  eq("the tier's exact division, never rounded", () => membershipPerSession(membershipById("single-2")), 90.625);
  // A program-only tier has no sessions, and price/0 is Infinity — the guard
  // is what keeps that out of every rate that falls back here.
  eq("a program-only tier has NO per-session price", () => membershipPerSession(membershipById("digital")), 0);
  eq("no tier, no price", () => membershipPerSession(null), 0);
});

describe("athleteSessionRate on a program-only tier", () => {
  // The Booked-ahead rows multiply by this. It used to return the monthly
  // number, pricing a single booked session at a whole month's fee while the
  // day strip beside it priced the same session at $0.
  eq("a flat member prices one booked session at zero, not a month",
    () => athleteSessionRate(athlete("digital", 250)), 0);
});

describe("flatMonthlyFor stays out of ordinary tiers", () => {
  // monthChargePlan calls this for EVERY tier and bills flat when it is
  // non-zero — a session tier leaking through here would flat-bill the whole
  // roster at their per-session rate.
  eq("a session tier is never flat, custom rate or not",
    () => flatMonthlyFor(athlete("single-2", 90), membershipById("single-2")), 0);
  // flatRate is the field new writes go to; rate is the permanent fallback for
  // grandfathered members and cached builds (see ensureSessionBank).
  eq("flatRate wins over rate when both are set",
    () => flatMonthlyFor({ sessionBank: { membership: "digital", rate: 999, flatRate: 175 } }, membershipById("digital")), 175);
  eq("only the old field still works (a member never re-saved since the split)",
    () => flatMonthlyFor({ sessionBank: { membership: "digital", rate: 175 } }, membershipById("digital")), 175);
});
