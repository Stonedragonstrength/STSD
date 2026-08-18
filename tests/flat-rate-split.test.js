// What a custom price on a bank MEANS, and why it needed its own field.
//
// `sessionBank.rate` is per-session everywhere in the app except on a
// program-only tier, where it was read as a whole MONTH (flatMonthlyFor). One
// field, two meanings, switched by the athlete's tier — so moving somebody off
// Digital turned "$250 a month" into "$250 a session" the moment their tier
// changed, which on an 8-session membership is an $8,000 invoice. Nothing threw
// and nothing on screen said a word.
//
// The pricing functions are the REAL ones, from the extracted module
// (Phase 3): requiring it executes the classic script, which assigns onto
// globalThis.STSD.money. It resolves tiers through the STSD.app.membershipById
// seam at call time, so this file publishes its fixture table there.
// changeMembership below is still a copy — the drawer handler stays in app.js.
const assert = require("assert");

const MEMBERSHIPS = [
  { id: "single-2", sessions: 8, price: 725 },
  { id: "single-4", sessions: 16, price: 1320 },
  { id: "digital", sessions: 0, price: 250 },
  { id: "no-session", sessions: 0 },
];
const membershipById = (id) => MEMBERSHIPS.find((m) => m.id === id) || null;

require(require("path").join(__dirname, "..", "src", "money", "pricing.js"));
globalThis.STSD.app = { ...globalThis.STSD.app, membershipById };
const { athleteSessionRate, flatMonthlyFor, bankPackagePrice } = globalThis.STSD.money;

// The reconciliation the membership <select> runs. Returns whether it repriced.
function changeMembership(c, nextId) {
  const prevM = membershipById(c.sessionBank.membership);
  const wasFlat = !!prevM && !prevM.sessions;
  const prevRate = Number(c.sessionBank.rate) || 0;
  c.sessionBank.membership = nextId || "";
  const nowM = membershipById(c.sessionBank.membership);
  const nowFlat = !!nowM && !nowM.sessions;
  if (prevRate > 0 && wasFlat !== nowFlat) {
    if (wasFlat) { c.sessionBank.flatRate = prevRate; c.sessionBank.rate = 0; return "was-monthly"; }
    c.sessionBank.rate = 0; c.sessionBank.flatRate = 0; return "was-per-session";
  }
  return "";
}

const bank = (o) => ({ sessionBank: { rate: 0, flatRate: 0, membership: "", ...o } });
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("  ok  " + name); };

console.log("flat-rate-split");

// ---- the bug this file exists for ---------------------------------------
t("moving a grandfathered flat member onto a session tier does not bill a month per session", () => {
  // Cheryl on Digital at $100 while the tier lists $250.
  const c = bank({ membership: "digital", rate: 100 });
  assert.strictEqual(flatMonthlyFor(c, membershipById("digital")), 100, "her own price, not the tier's");
  const why = changeMembership(c, "single-2");
  assert.strictEqual(why, "was-monthly");
  // The old behaviour: rate stayed 100 and 8 sessions billed at $800.
  assert.strictEqual(c.sessionBank.rate, 0, "per-session rate cleared");
  assert.strictEqual(c.sessionBank.flatRate, 100, "monthly price kept in case she moves back");
  assert.strictEqual(bankPackagePrice(c, membershipById("single-2"), 8), 725, "bills the tier's list price");
});

t("and the $8,000 case specifically", () => {
  const c = bank({ membership: "digital", rate: 250 });
  changeMembership(c, "single-4");                       // 16 sessions
  assert.notStrictEqual(bankPackagePrice(c, membershipById("single-4"), 16), 4000);
  assert.strictEqual(bankPackagePrice(c, membershipById("single-4"), 16), 1320);
});

t("moving back restores the monthly price rather than the list price", () => {
  const c = bank({ membership: "digital", rate: 100 });
  changeMembership(c, "single-2");
  changeMembership(c, "digital");
  assert.strictEqual(flatMonthlyFor(c, membershipById("digital")), 100, "still hers, not $250");
});

t("a per-session rate is not carried onto a flat tier as a month", () => {
  const c = bank({ membership: "single-2", rate: 90 });
  const why = changeMembership(c, "digital");
  assert.strictEqual(why, "was-per-session");
  assert.strictEqual(c.sessionBank.flatRate, 0);
  // `rate` has to be cleared too, not merely left unread: flatMonthlyFor still
  // falls back to it for members grandfathered in before the split, so $90 a
  // session left sitting there becomes $90 a MONTH. The mirror image of the
  // bug this file is named for, and the first draft of the fix shipped it.
  assert.strictEqual(c.sessionBank.rate, 0);
  assert.strictEqual(flatMonthlyFor(c, membershipById("digital")), 250, "the tier's price, not $90 a month");
});

// ---- the fallback that keeps existing data and cached builds working -----
t("an untouched flat member with only the old field keeps their price", () => {
  const c = bank({ membership: "digital", rate: 175 });   // never re-saved since the split
  assert.strictEqual(flatMonthlyFor(c, membershipById("digital")), 175);
});

t("flatRate wins over rate when both are set", () => {
  const c = bank({ membership: "digital", rate: 999, flatRate: 175 });
  assert.strictEqual(flatMonthlyFor(c, membershipById("digital")), 175);
});

t("no custom price at all falls back to the tier", () => {
  assert.strictEqual(flatMonthlyFor(bank({ membership: "digital" }), membershipById("digital")), 250);
  // A program-only tier with no price is genuinely $0, not a crash.
  assert.strictEqual(flatMonthlyFor(bank({ membership: "no-session" }), membershipById("no-session")), 0);
});

// ---- the second half: a flat tier has no per-session price ---------------
t("a program-only member prices one booked session at zero, not at a month", () => {
  const c = bank({ membership: "digital", rate: 250 });
  // This is what the Booked-ahead rows multiply by. It used to return 250, so
  // a single session on the calendar read as a whole month of income while the
  // day strip beside it priced the same session at $0.
  assert.strictEqual(athleteSessionRate(c), 0);
});

t("ordinary tiers are untouched by all of this", () => {
  assert.strictEqual(athleteSessionRate(bank({ membership: "single-2", rate: 78 })), 78, "custom wins");
  assert.strictEqual(athleteSessionRate(bank({ membership: "single-2" })), 725 / 8, "else the tier");
  assert.strictEqual(bankPackagePrice(bank({ membership: "single-2" }), membershipById("single-2"), 8), 725);
  // A typed 0 still means zero (package-price.test.js pins this too).
  assert.strictEqual(bankPackagePrice(bank({ membership: "single-2", rate: 90 }), membershipById("single-2"), 0), 0);
});

t("changing between two session tiers leaves a custom rate alone", () => {
  const c = bank({ membership: "single-2", rate: 78 });
  assert.strictEqual(changeMembership(c, "single-4"), "", "no reprice message");
  assert.strictEqual(c.sessionBank.rate, 78);
});

console.log(`flat-rate-split: ${n} checks passed.`);
