// The couple mirror — bankMutated(c) and the four fields it historically missed.
//
// A couple shares ONE session bank: bankMutated clones the bank's money fields
// onto the partner so either half's page shows the shared state. Four newer
// fields were written with a bankMutated call right after — plainly expecting
// the mirror — and never got copied: `credits` (credit for unused sessions),
// `creditUnused` (its toggle), `creditCap`, and `payBy` (the 💳/💵 memory).
// So each landed on whichever half the coach had open and stayed there:
// credit accrued under one half silently didn't discount a month billed from
// the other, and the credit toggle could accrue nothing at all depending on
// roster order. Owner-ruled 2026-08-18: one pot per couple — the four fields
// mirror, and reconcileCoupleBanks() heals pairs that diverged before the fix.
//
// Runs the REAL functions, extracted from app.js by brace-matching.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
// The ledger core (pkgMonth, bankLedger, the credit arithmetic) moved to
// src/money/ledger.js (Phase 3 extraction); the mirror and the state writers
// under test here stay in app.js.
const ledgerSrc = fs.readFileSync(path.join(ROOT, "src", "money", "ledger.js"), "utf8");
const LEDGER_DECLS = new Set(["function pkgMonth(", "function bankLedger(", "function creditBalance("]);

function fnSrc(decl) {
  const src = LEDGER_DECLS.has(decl) ? ledgerSrc : appSrc;
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`not found: ${decl}`);
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error(`unbalanced: ${decl}`);
}

// The credit helpers are const arrows, not declarations, so the block is
// sliced by its landmarks rather than brace-matched.
function creditConstBlock() {
  const from = ledgerSrc.indexOf("const CREDIT_CAP_DEFAULT");
  const to = ledgerSrc.indexOf("function creditBalance(");
  if (from < 0 || to < 0 || to <= from) throw new Error("credit const block not found");
  return ledgerSrc.slice(from, to);
}

// The whole partner-mirror neighbourhood, with its collaborators supplied.
// state/localStorage/pushAthlete are per-build so each test reads its own spies.
function build(clients) {
  const pushes = [];
  const stores = [];
  const scope = `
    const state = { trainerData: { clients } };
    const KEY_TRAINER = "trainerpro_data_v1";
    const localStorage = { setItem: (k) => { stores.push(k); }, getItem: () => null };
    const pushAthlete = (c) => { if (c) pushes.push(c.id); };
    const saveTrainer = () => {};
    const toast = () => {};
    const todayISO = () => "2026-08-18";
    let _n = 0;
    const uid = () => "u" + (++_n);
    const athleteSessionRate = (c) => (c && c.__rate) || 0;
    const monthChargePlan = (c) => ({ gross: (c && c.__gross) || 0 });
    ${fnSrc("function pkgMonth(")}
    ${fnSrc("function ensureSessionBank(")}
    ${fnSrc("function bankLedger(")}
    ${creditConstBlock()}
    ${fnSrc("function creditBalance(")}
    ${fnSrc("function partnerOf(")}
    ${fnSrc("function bankMutated(")}
    ${fnSrc("function mergeBankPot(")}
    ${fnSrc("function reconcileCoupleBanks(")}
    ${fnSrc("function linkPartners(")}
    ${fnSrc("function accrueSessionCredits(")}
    ${fnSrc("function applyCreditAfterCharge(")}
    return { bankMutated, mergeBankPot, reconcileCoupleBanks, linkPartners,
             accrueSessionCredits, applyCreditAfterCharge, creditBalance, creditCapOf };
  `;
  const api = new Function("clients", "pushes", "stores", scope)(clients, pushes, stores);
  return { api, pushes, stores };
}

const earned = (o) => Object.assign(
  { id: "e1", kind: "earned", monthKey: "2026-07", sessions: 2, amount: 200, rate: 100, addedAt: 1 }, o);
const couple = (aBank, bBank) => {
  const a = { id: "a", name: "A", partnerId: "b", sessionBank: aBank };
  const b = { id: "b", name: "B", partnerId: "a", sessionBank: bBank };
  return [a, b];
};
const bank = (o) => Object.assign({ packages: [], redemptions: [] }, o);

let passed = 0;
const ok = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

console.log("bank mirror (couples share one pot)");

ok("bankMutated mirrors the credit pot and the 💳/💵 memory, by value", () => {
  const [a, b] = couple(
    bank({ credits: [earned({})], creditUnused: true, creditCap: 3, payBy: "manual" }),
    bank({}));
  const { api } = build([a, b]);
  api.bankMutated(a);
  assert.deepStrictEqual(b.sessionBank.credits, a.sessionBank.credits, "credits did not reach the partner");
  assert.strictEqual(b.sessionBank.creditUnused, true);
  assert.strictEqual(b.sessionBank.creditCap, 3);
  assert.strictEqual(b.sessionBank.payBy, "manual");
  // A clone, not a reference — a later write to one half must go through
  // bankMutated again, never alias its way across.
  a.sessionBank.credits.push(earned({ id: "e2" }));
  assert.strictEqual(b.sessionBank.credits.length, 1, "the mirror aliased the array instead of cloning it");
});

ok("bankMutated still leaves the per-athlete fields alone", () => {
  // messages/bulletins/upcomingBookings are deliberately NOT shared — bookings
  // get a partner union elsewhere, notices are per-athlete. Pin the exclusion
  // so "mirror everything" never leaks them across.
  const [a, b] = couple(bank({}), bank({
    messages: [{ id: "m1" }], bulletins: [{ id: "n1" }], upcomingBookings: [{ id: "u1" }],
  }));
  const { api } = build([a, b]);
  api.bankMutated(a);
  assert.strictEqual(b.sessionBank.messages.length, 1);
  assert.strictEqual(b.sessionBank.bulletins.length, 1);
  assert.strictEqual(b.sessionBank.upcomingBookings.length, 1);
});

ok("no partner, no-op", () => {
  const a = { id: "a", sessionBank: bank({ credits: [earned({})] }) };
  const { api, pushes } = build([a]);
  api.bankMutated(a);
  assert.strictEqual(pushes.length, 0);
});

ok("mergeBankPot unions credits by id, idempotently", () => {
  const A = bank({ credits: [earned({ id: "e1" })] });
  const B = bank({ credits: [earned({ id: "e1" }), earned({ id: "e2", monthKey: "2026-06" })] });
  const { api } = build([]);
  api.mergeBankPot(A, B);
  assert.deepStrictEqual(A.credits.map((e) => e.id), ["e1", "e2"]);
  assert.deepStrictEqual(B.credits.map((e) => e.id), ["e1", "e2"]);
  api.mergeBankPot(A, B); // running it again must add nothing
  assert.strictEqual(A.credits.length, 2, "the union is not idempotent — every boot would duplicate the pot");
  assert.strictEqual(B.credits.length, 2);
});

ok("the toggle: on for the bank if either half was on — but rollover still wins", () => {
  const { api } = build([]);
  const A = bank({}), B = bank({ creditUnused: true });
  api.mergeBankPot(A, B);
  assert.strictEqual(A.creditUnused, true, "the half the coach toggled was ignored");
  assert.strictEqual(B.creditUnused, true);
  // Rollover means the sessions carry, so there is nothing left over to pay
  // back — the same "never both" rule the drawer toggles enforce.
  const C = bank({ rollover: true }), D = bank({ creditUnused: true });
  api.mergeBankPot(C, D);
  assert.strictEqual(C.creditUnused, false, "credit and rollover were both left on");
  assert.strictEqual(D.creditUnused, false);
});

ok("the cap: the half that has one answers; two caps keep the kinder one", () => {
  const { api } = build([]);
  const A = bank({}), B = bank({ creditCap: 4 });
  api.mergeBankPot(A, B);
  assert.strictEqual(A.creditCap, 4);
  assert.strictEqual(B.creditCap, 4);
  const C = bank({ creditCap: 1 }), D = bank({ creditCap: 4 });
  api.mergeBankPot(C, D);
  assert.strictEqual(C.creditCap, 4);
  // Neither half set one: no key appears, so creditCapOf keeps its default.
  const E = bank({}), F = bank({});
  api.mergeBankPot(E, F);
  assert.strictEqual(api.creditCapOf({ sessionBank: E }), 2, "an invented cap overrode the default");
});

ok("💳/💵: the half that knows answers; a disagreement clears both", () => {
  const { api } = build([]);
  const A = bank({}), B = bank({ payBy: "card" });
  api.mergeBankPot(A, B);
  assert.strictEqual(A.payBy, "card");
  assert.strictEqual(B.payBy, "card");
  // Two different answers can only predate the mirror, and bankPayBy already
  // falls back to how they last actually paid — clearing both stays honest.
  const C = bank({ payBy: "manual" }), D = bank({ payBy: "card" });
  api.mergeBankPot(C, D);
  assert.strictEqual(C.payBy, undefined, "a conflicted chip kept a guess");
  assert.strictEqual(D.payBy, undefined);
});

ok("reconcileCoupleBanks converges a diverged pair and pushes BOTH halves", () => {
  const [a, b] = couple(bank({ credits: [earned({})] }), bank({ payBy: "card" }));
  const { api, pushes, stores } = build([a, b]);
  api.reconcileCoupleBanks();
  assert.deepStrictEqual(b.sessionBank.credits, a.sessionBank.credits);
  assert.strictEqual(a.sessionBank.payBy, "card");
  assert.ok(pushes.includes("a") && pushes.includes("b"), "a healed half was never pushed — its device keeps the split pot");
  assert.ok(stores.includes("trainerpro_data_v1"), "the heal was never persisted locally");
});

ok("reconcileCoupleBanks leaves a converged pair alone — no pushes, no writes", () => {
  const credits = [earned({})];
  const [a, b] = couple(
    bank({ credits: structuredClone(credits), creditUnused: true, payBy: "card" }),
    bank({ credits: structuredClone(credits), creditUnused: true, payBy: "card" }));
  const { api, pushes, stores } = build([a, b]);
  api.reconcileCoupleBanks();
  assert.strictEqual(pushes.length, 0, "an untouched pair was pushed — every boot would write the whole roster");
  assert.strictEqual(stores.length, 0);
});

ok("THE BUG: credit earned under one half discounts a month billed from the other", () => {
  const [a, b] = couple(
    bank({ credits: [earned({ amount: 200 })], creditUnused: true }),
    bank({ creditUnused: true }));
  b.__gross = 500;
  const { api } = build([a, b]);
  api.reconcileCoupleBanks(); // boot heals the halves first
  // The coach bills the month from B's row: gross 500, invoice went out at 300,
  // so the 200 credit is what covered the difference and must be spent.
  api.applyCreditAfterCharge(b, "2026-08", 300, "ch1");
  assert.strictEqual(api.creditBalance(b), 0, "the discount was never spent — next month gets it again");
  assert.strictEqual(api.creditBalance(a), 0, "the other half still shows credit that was already used");
});

ok("accrual: the toggle set on the LATER half still accrues, once, for the bank", () => {
  // Pre-fix, accrueSessionCredits read creditsOn() off whichever half came
  // first in the roster — a flag set on the other half accrued nothing, ever.
  const july = {
    packages: [{ id: "p1", size: 4, membershipGrant: "2026-07", price: 400 }],
    redemptions: [{ id: "r1", date: "2026-07-10" }],
  };
  const [a, b] = couple(bank(structuredClone(july)), bank(Object.assign(structuredClone(july), { creditUnused: true })));
  a.__rate = 100;
  const { api } = build([a, b]);
  api.reconcileCoupleBanks();
  api.accrueSessionCredits();
  // July closed with 3 left; the default cap of 2 keeps it a gesture: 2 × $100.
  assert.strictEqual(api.creditBalance(a), 200, "the bank earned nothing — the toggle sat on the half accrual never reads");
  assert.strictEqual(api.creditBalance(b), 200, "the partner's copy never got the earned credit");
  api.accrueSessionCredits(); // a month is credited once, ever
  assert.strictEqual(api.creditBalance(a), 200, "a second pass re-credited the same month");
  assert.strictEqual(a.sessionBank.credits.length, 1);
});

ok("linkPartners keeps the incoming half's credits — the link must not wipe them", () => {
  const a = { id: "a", name: "A", sessionBank: bank({}) };
  const b = { id: "b", name: "B", sessionBank: bank({ credits: [earned({})], creditUnused: true }) };
  const { api } = build([a, b]);
  api.linkPartners(a, b);
  assert.strictEqual(api.creditBalance(a), 200, "B's credit vanished when the couple was linked");
  assert.strictEqual(api.creditBalance(b), 200);
  assert.strictEqual(a.sessionBank.creditUnused, true);
});

console.log(`\n${passed} passed`);
