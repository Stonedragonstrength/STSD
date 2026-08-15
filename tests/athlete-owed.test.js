// `athleteOwed` — what one athlete owes, as ONE number.
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
// Runs the REAL function, extracted from app.js by brace-matching.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function fnSrc(decl) {
  const at = appSrc.indexOf(decl);
  if (at < 0) throw new Error(`not found: ${decl}`);
  const open = appSrc.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < appSrc.length; i++) {
    if (appSrc[i] === "{") depth++;
    else if (appSrc[i] === "}") { depth--; if (!depth) return appSrc.slice(at, i + 1); }
  }
  throw new Error(`unbalanced: ${decl}`);
}

const TODAY = "2026-08-15";

// The real function, with its collaborators supplied. pkgOwed/pkgMonth and the
// date helpers are the SHIPPED ones too, so a change to what "owed" means
// reaches this test instead of leaving a copy behind.
function build(billing) {
  const scope = `
    ${fnSrc("function pkgMonth(")}
    ${fnSrc("function pkgOwed(")}
    ${fnSrc("function daysBetweenISO(")}
    ${fnSrc("function dateISO(")}
    const todayISO = () => ${JSON.stringify(TODAY)};
    const ensureSessionBank = (c) => { if (!c.sessionBank) c.sessionBank = { packages: [] }; };
    const _billing = ${JSON.stringify(billing)};
    ${fnSrc("function athleteOwed(")}
    return athleteOwed;
  `;
  return new Function(scope)();
}

const pay = (o) => Object.assign(
  { athlete_id: "a", status: "sent", month_key: "2026-07", amount_cents: 85000, created_at: "2026-07-01T10:00:00Z" }, o);
const ath = (o) => Object.assign({ id: "a", name: "A", sessionBank: { packages: [] } }, o);

let passed = 0;
const ok = (name, fn) => {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
};

console.log("athleteOwed");

ok("nothing owed reads zero, not NaN", () => {
  const f = build({ payments: [] });
  const r = f(ath());
  assert.strictEqual(r.total, 0);
  assert.deepStrictEqual(r.months, []);
});

ok("a sent charge is owed, in dollars", () => {
  const f = build({ payments: [pay({})] });
  const r = f(ath());
  assert.strictEqual(r.total, 850);
  assert.deepStrictEqual(r.months, ["2026-07"]);
});

ok("a PAID charge is not owed", () => {
  const f = build({ payments: [pay({ status: "paid" })] });
  assert.strictEqual(f(ath()).total, 0);
});

ok("an unpaid package with no charge is owed", () => {
  const f = build({ payments: [] });
  const c = ath({ sessionBank: { packages: [{ price: 170, unpaid: true, addedAt: Date.parse("2026-06-01") }] } });
  const r = f(c);
  assert.strictEqual(r.total, 170);
  assert.strictEqual(r.fromPackages, 170);
});

ok("THE BUG: a month billed AND still flagged counts ONCE, at the charge's amount", () => {
  // settleBilledPackages only clears `unpaid` on payment, so an ignored invoice
  // leaves both records standing. They are one debt.
  const f = build({ payments: [pay({ month_key: "2026-07", amount_cents: 85000 })] });
  const c = ath({ sessionBank: { packages: [
    { price: 850, unpaid: true, membershipGrant: "2026-07", addedAt: Date.parse("2026-07-01") },
  ] } });
  const r = f(c);
  assert.strictEqual(r.total, 850, "the same month was counted twice — the coach chases double what he is owed");
  assert.strictEqual(r.fromCard, 850);
  assert.strictEqual(r.fromPackages, 0, "the package must yield to the charge, which is the figure actually sent");
});

ok("a package with no month key never collides, so it adds", () => {
  // A one-off pack is not a membership grant and has no invoice to duplicate.
  const f = build({ payments: [pay({ month_key: "2026-07", amount_cents: 85000 })] });
  const c = ath({ sessionBank: { packages: [
    { price: 850, unpaid: true, membershipGrant: "2026-07" },   // same debt as the charge
    { price: 200, unpaid: true },                                // a separate pack
  ] } });
  assert.strictEqual(f(c).total, 1050);
});

ok("a couple's debt counts under either half", () => {
  // One bank, one card. A charge raised under Kevin is Sarah's bank's debt too,
  // and a sheet opened on her must not read zero.
  const f = build({ payments: [pay({ athlete_id: "kevin", month_key: "2026-07", amount_cents: 136000 })] });
  const sarah = ath({ id: "sarah", partnerId: "kevin" });
  const kevin = ath({ id: "kevin", partnerId: "sarah" });
  assert.strictEqual(f(sarah).total, 1360, "Sarah's sheet reported none of the bank's debt");
  assert.strictEqual(f(kevin).total, 1360);
  assert.strictEqual(f(sarah).total, f(kevin).total, "the two halves must agree — see stsd-couples-share-one-bank");
});

ok("a re-sent month uses the newest ask, not both", () => {
  const f = build({ payments: [
    pay({ month_key: "2026-07", amount_cents: 85000, created_at: "2026-07-01T10:00:00Z" }),
    pay({ month_key: "2026-07", amount_cents: 90000, created_at: "2026-07-09T10:00:00Z" }),
  ] });
  assert.strictEqual(f(ath()).total, 900);
});

ok("this month's invoice is owed but NOT overdue", () => {
  // It was only just sent. Listing it as overdue would have the coach chasing
  // someone on the day he billed them.
  const f = build({ payments: [pay({ month_key: "2026-08", created_at: "2026-08-01T10:00:00Z" })] });
  const r = f(ath());
  assert.strictEqual(r.total, 850, "still counts toward what is owed");
  assert.deepStrictEqual(r.months, [], "but it is not late");
});

ok("oldest age is reported in days", () => {
  const f = build({ payments: [
    pay({ month_key: "2026-06", created_at: "2026-06-14T10:00:00Z" }),
    pay({ month_key: "2026-07", created_at: "2026-07-14T10:00:00Z" }),
  ] });
  const r = f(ath());
  assert.strictEqual(r.oldestDays, 62);
  assert.deepStrictEqual(r.months, ["2026-06", "2026-07"]);
});

ok("cents survive the sum", () => {
  const f = build({ payments: [pay({ amount_cents: 76950 })] });
  assert.strictEqual(f(ath()).total, 769.5);
});

console.log(`\n${passed} passed`);
