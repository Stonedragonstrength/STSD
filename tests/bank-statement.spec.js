// The bank statement: packages and sessions as one stream, grouped by month.
//
// This exists because of a real morning. "When did she get that auto-renew
// for August?" could not be answered from any screen in the app — the answer
// was a query against production — and "why does she have so many sessions?"
// took reading four package rows against five session rows and redoing
// bankLedger's arithmetic by hand. Both facts were already in the data:
// every package carries `addedAt`, and bankLedger already returns `byMonth`.
// Neither was ever rendered.
//
// The fixture is one real bank's SHAPE, taken from production because the
// bug was in the shape of that data and a tidier fixture would not have it:
// three packages added through "Add training package" (no month stamp, so
// they never expire and monthPackageOf cannot see them), one auto-renew
// allowance for August, and five sessions all taken in July.
import { describe, it, expect, afterAll } from "vitest";
import { loadFns } from "./helpers/load-fn.js";
// Same window-shim contract every src/money spec uses: importing registers
// onto globalThis.STSD.money. projection.js needs ledger.js loaded first.
import "../src/money/ledger.js";
import "../src/money/pricing.js";
import "../src/money/projection.js";

const { sessionBankSummary, pkgMonth, pkgOwed, pkgExpired, monthPackageOf } =
  globalThis.STSD.money;

const TODAY = "2026-08-21";

// Four packages, in the order they were created.
const PACKAGES = [
  { id: "p1", size: 1, status: "paid", addedAt: Date.parse("2026-07-09T18:46:00Z") },
  { id: "p2", size: 1, status: "paid", addedAt: Date.parse("2026-07-14T05:33:00Z") },
  { id: "p3", size: 4, status: "paid", addedAt: Date.parse("2026-07-30T02:39:00Z") },
  { id: "p4", size: 4, status: "paid", unpaid: true, price: 300, booked: 2,
    autoRenewGrant: "2026-08", addedAt: Date.parse("2026-08-01T14:43:00Z"),
    note: "Auto-renew · August 2026 · 4 booked sessions" },
];
const REDEMPTIONS = [
  { id: "r1", date: "2026-07-09", note: "Booked session · 9:30 AM" },
  { id: "r2", date: "2026-07-10", note: "Booked session · 4:30 PM" },
  { id: "r3", date: "2026-07-23", note: "Booked session · 10:00 AM" },
  { id: "r4", date: "2026-07-24", note: "Booked session · 6:00 AM" },
  { id: "r5", date: "2026-07-30", note: "Booked session · 7:00 AM" },
];
const athlete = () => ({
  id: "a1", name: "The athlete",
  sessionBank: {
    membership: "single-1", autoRenew: true, rollover: false,
    packages: PACKAGES.map((p) => ({ ...p })),
    redemptions: REDEMPTIONS.map((r) => ({ ...r })),
    missedSessions: [],
  },
});

const MONTH_NAMES = ["January","February","March","April","May","June","July",
  "August","September","October","November","December"];
const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// The money modules reach app state back through the STSD.app seam. Published
// at module scope, not in a hook: the fixtures below call the chain at
// collection time, which runs before any beforeAll.
const prevApp = globalThis.STSD.app;
globalThis.STSD.app = {
  ...prevApp,
  todayISO: () => TODAY,
  membershipById: (id) => (id === "single-1"
    ? { id: "single-1", cat: "Single Sessions", perWeek: 1, sessions: 4, price: 400 } : null),
  partnerOf: () => null,
  ensureSessionBank: (c) => {
    if (!c.sessionBank || typeof c.sessionBank !== "object") c.sessionBank = {};
    if (!Array.isArray(c.sessionBank.packages)) c.sessionBank.packages = [];
    if (!Array.isArray(c.sessionBank.redemptions)) c.sessionBank.redemptions = [];
  },
};
afterAll(() => { globalThis.STSD.app = prevApp; });

function build() {
  const deps = {
    // Real money module, so the arithmetic under test is the shipped ledger.
    sessionBankSummary, pkgMonth, pkgOwed, pkgExpired,
    ensureSessionBank: () => {},
    todayISO: () => TODAY,
    dateISO: (d) => {
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },
    escapeHtml: (s) => String(s ?? "").replace(/[&<>"']/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])),
    money: (n) => `$${Number(n).toLocaleString()}`,
    MONTH_NAMES, DOW_LABELS,
  };
  // Pulled in dependency order. Every one of these is the shipped source.
  const fns = loadFns([
    "function monthKeyLabel(",
    "function sessionLogWhen(",
    "const SESSION_KINDS =",
    "function splitRedemptionNote(",
    "function sessionLogRows(",
    "function sessionLogRowHtml(",
    "function bankWhyLine(",
    "function pkgOrigin(",
    "function bankPkgRowHtml(",
    "function bankStatementHtml(",
  ], deps);
  return fns;
}

describe("bank statement", () => {
  const F = build();

  it("reproduces the balance production actually shows", () => {
    const sum = sessionBankSummary(athlete());
    // 6 bought sessions that never expire, 5 of them spent in July, plus
    // August's 4-session allowance. This is the number the app shows.
    expect(sum.remaining).toBe(5);
    expect(sum.thisMonthGrant).toBe(4);
    expect(sum.thisMonth).toBe(4);
    expect(sum.banked).toBe(1);
  });

  it("shows the balance's working, and never money", () => {
    const line = F.bankWhyLine(sessionBankSummary(athlete()));
    expect(line).toContain("5");
    expect(line).toContain("August's allowance");
    expect(line).toContain("banked from packages");
    // This line renders on the athlete's card too.
    expect(line).not.toContain("$");
    expect(line).not.toMatch(/collect/i);
  });

  it("stays silent when the total has only one source", () => {
    // No bought packs: the stat tiles above already say it, and repeating it
    // would put the same figure on the card three times.
    const c = athlete();
    c.sessionBank.packages = [PACKAGES[3]];
    c.sessionBank.redemptions = [];
    expect(F.bankWhyLine(sessionBankSummary(c))).toBe("");
  });

  it("names WHICH door made each package", () => {
    expect(F.pkgOrigin(PACKAGES[3]).text).toBe("Auto-renew");
    expect(F.pkgOrigin(PACKAGES[0]).text).toBe("Added by hand");
    expect(F.pkgOrigin({ membershipGrant: "2026-08" }).text).toBe("Granted by you");
    expect(F.pkgOrigin({ gift: true }).text).toBe("Gift");
    expect(F.pkgOrigin({ requestId: "q1" }).text).toBe("From their request");
  });

  it("prints the creation time that answers 'when did she get August?'", () => {
    const html = F.bankStatementHtml(athlete(), "coach");
    // 1 Aug, and the clock time beside it. The whole point of the redesign:
    // addedAt was always stored and never shown.
    expect(html).toMatch(/Sat 1 Aug/);
    expect(html).toMatch(/<em>[^<]*\d:\d\d/);
    expect(html).toContain("🔁 Auto-renew");
  });

  it("puts the header arithmetic on every month, from the ledger", () => {
    const html = F.bankStatementHtml(athlete(), "coach");
    expect(html).toContain("August 2026");
    expect(html).toContain("<b>4</b> granted");
    expect(html).toContain("<b>4</b> left");
    expect(html).toContain("July 2026");
    expect(html).toContain("<b>5</b> used");
  });

  it("keeps the booked-against-tier advisory, and drops the note the app wrote", () => {
    const html = F.bankStatementHtml(athlete(), "coach");
    // The advisory nearly died in the rewrite; it is the one number that says
    // a membership is the wrong size.
    expect(html).toContain("2 booked");
    expect(html).toContain("2 of the allowance unused");
    // "Auto-renew · August 2026 · 4 booked sessions" is machine-written and
    // every word of it is already on the row. A note the coach typed is not.
    expect(html).not.toContain("Auto-renew · August 2026 · 4 booked sessions");
    const c = athlete();
    c.sessionBank.packages[0].note = "Venmo, ref 1234";
    expect(F.bankStatementHtml(c, "coach")).toContain("Venmo, ref 1234");
  });

  it("flags a month booked over the tier", () => {
    const c = athlete();
    c.sessionBank.packages[3].booked = 6;
    expect(F.bankStatementHtml(c, "coach")).toContain("2 over the tier");
  });

  it("separates an allowance from a pack that never expires", () => {
    const html = F.bankStatementHtml(athlete(), "coach");
    expect(html).toContain("never expires");
    expect(html).toMatch(/August 2026 allowance/);
  });

  it("gives packages and sessions different delete hooks", () => {
    // They share one container now. One selector for both would wire "remove
    // this package" to the × on a session row: a delete on the wrong record,
    // silently. This is the assertion that stops that coming back.
    const html = F.bankStatementHtml(athlete(), "coach");
    expect(html).toMatch(/data-pkg-del="p1"/);
    expect(html).toMatch(/data-del="r1"/);
    expect(html).not.toMatch(/data-del="p1"/);
  });

  it("shows the athlete what landed, and none of the money", () => {
    const html = F.bankStatementHtml(athlete(), "athlete");
    expect(html).toContain("🔁 Auto-renew");
    expect(html).not.toContain("$300");
    expect(html).not.toMatch(/still to collect/);
    expect(html).not.toMatch(/data-pay=/);
    expect(html).not.toMatch(/data-pkg-del=/);
    expect(html).not.toMatch(/data-del=/);      // no undo on their side either
  });

  it("keeps every session the log used to carry", () => {
    const c = athlete();
    c.sessionBank.redemptions.push({ id: "r6", date: "2026-08-05", note: "Missed session: charged · 8:00 AM" });
    c.sessionBank.missedSessions = [{ id: "m1", date: "2026-08-12", type: "closecall" }];
    const html = F.bankStatementHtml(c, "coach");
    // A waived close call is not a delivered session and not a lost one; it
    // had its own row in the old log and it keeps it here.
    expect(html).toContain("Close call: waived");
    expect(html).toContain("waived");
    expect(html).toContain("1 missed");
  });

  it("does not render a declined request as an event", () => {
    const c = athlete();
    c.sessionBank.packages.push({ id: "x", size: 0, status: "cancelled",
      addedAt: Date.parse("2026-08-03T00:00:00Z"), note: "Athlete request declined" });
    expect(F.bankStatementHtml(c, "coach")).not.toContain("Athlete request declined");
  });

  it("renders nothing at all for an empty bank", () => {
    const c = athlete();
    c.sessionBank.packages = [];
    c.sessionBank.redemptions = [];
    // "" is the signal renderCoachSessions uses to show its empty-state copy.
    expect(F.bankStatementHtml(c, "coach")).toBe("");
  });
});

describe("the collision the Add-package button could not see", () => {
  it("is exactly what monthPackageOf misses", () => {
    const c = athlete();
    // Her 29 July four-pack carries no month, so the guard that stops a month
    // being granted twice cannot see it — which is how August arrived twice.
    const hand = c.sessionBank.packages[2];
    expect(pkgMonth(hand)).toBe("");
    // The auto grant IS visible, which is what the new confirm keys off.
    expect(monthPackageOf(c, "2026-08")?.id).toBe("p4");
    // And with only the hand-added pack, the guard finds nothing at all.
    c.sessionBank.packages = [hand];
    expect(monthPackageOf(c, "2026-08")).toBe(null);
  });
});
