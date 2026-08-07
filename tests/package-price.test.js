// What a month of a membership costs a given athlete.
//
// This earns a test because it decides what athletes are asked to pay. A custom
// per-session rate lives on the bank and overrides the tier's list price, and it
// has to multiply by the sessions in the package. Every grant used to stamp the
// tier price flat, so an athlete on a custom rate was quoted the list price and
// nothing on screen said otherwise -- the Bill sheet priced them off the custom
// rate while Settle showed the tier's number, and the two silently disagreed.
//
// The case that matters most is the boring one: an athlete with NO custom rate
// must still come out at exactly the tier price. The fallback rate is
// price/sessions, so the multiply has to be an identity for them, or this fix
// would have quietly re-priced the whole roster.
//
// DUPLICATES membershipPerSession, athleteSessionRate and bankPackagePrice
// (app.js), which is one IIFE with no exports. Change the original, change the
// copy here too, or this guards nothing.

// ---- copy of app.js ----
const MEMBERSHIPS = [
  { id: "single-2", cat: "Single Sessions", perWeek: 2, sessions: 8, price: 725 },
  { id: "single-3", cat: "Single Sessions", perWeek: 3, sessions: 12, price: 1020 },
  { id: "couples-2", cat: "Couples Sessions", perWeek: 2, sessions: 8, price: 1040 },
  { id: "digital", cat: "Monthly Memberships", sessions: 0, price: 250 },
  { id: "no-session", cat: "Monthly Memberships", sessions: 0 },
];
const membershipById = (id) => MEMBERSHIPS.find((m) => m.id === id) || null;

function membershipPerSession(m) {
  return m && m.price && m.sessions ? m.price / m.sessions : 0;
}
function athleteSessionRate(c) {
  if (!c) return 0;
  const own = Number(c.sessionBank?.rate);
  if (own > 0) return own;
  return membershipPerSession(membershipById(c.sessionBank?.membership || ""));
}
function bankPackagePrice(c, m, size) {
  if (!m) return 0;
  if (!m.sessions) return Number(m.price) || 0;
  const n = Number(size) > 0 ? Number(size) : m.sessions;
  return Math.round(athleteSessionRate(c) * n);
}
// ---- end copy ----

let pass = 0, fail = 0;
function eq(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}
const athlete = (membership, rate) => ({ sessionBank: { membership, ...(rate === undefined ? {} : { rate }) } });

console.log("no custom rate — must be EXACTLY the tier price");
// The regression guard. If the multiply is not an identity here, this "fix"
// silently re-prices every athlete who never had a custom rate.
eq("8-session tier", bankPackagePrice(athlete("single-2"), membershipById("single-2"), 8), 725);
eq("12-session tier", bankPackagePrice(athlete("single-3"), membershipById("single-3"), 12), 1020);
eq("couples tier", bankPackagePrice(athlete("couples-2"), membershipById("couples-2"), 8), 1040);
// 725/8 = 90.625 — a rate that does not divide evenly still has to round back.
eq("uneven per-session rate rounds back to the tier price",
   bankPackagePrice(athlete("single-2"), membershipById("single-2"), 8), 725);
eq("rate of 0 is not a custom rate",
   bankPackagePrice(athlete("single-2", 0), membershipById("single-2"), 8), 725);
eq("missing sessionBank falls back to the tier",
   bankPackagePrice({}, membershipById("single-2"), 8), 0);

console.log("\ncustom rate overrides the tier and multiplies");
eq("$80 × 8", bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), 8), 640);
eq("$80 × 12", bankPackagePrice(athlete("single-3", 80), membershipById("single-3"), 12), 960);
eq("$100 × 8 beats the $725 list price",
   bankPackagePrice(athlete("single-2", 100), membershipById("single-2"), 8), 800);
// The bug as reported: a custom rate was ignored and the list price billed.
eq("a custom rate is never the tier price by accident",
   bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), 8) === 725, false);
eq("fractional rate rounds to whole dollars",
   bankPackagePrice(athlete("single-2", 90.5), membershipById("single-2"), 8), 724);

console.log("\npriced by the PACKAGE's size, not the tier's");
// A package keeps the size it was granted with; the tier can change under it.
eq("half a package at a custom rate",
   bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), 4), 320);
eq("a bigger package than the tier",
   bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), 20), 1600);
eq("absent size falls back to the tier's sessions",
   bankPackagePrice(athlete("single-2", 80), membershipById("single-2")), 640);
eq("zero size falls back rather than pricing at nothing",
   bankPackagePrice(athlete("single-2", 80), membershipById("single-2"), 0), 640);

console.log("\nprogram-only tiers are flat and never multiplied");
eq("digital membership is its monthly price",
   bankPackagePrice(athlete("digital"), membershipById("digital"), 0), 250);
// The important one: a session rate must not turn a flat plan into rate × 0.
eq("a custom rate does not zero a flat plan",
   bankPackagePrice(athlete("digital", 80), membershipById("digital"), 8), 250);
eq("no-session no-price tier is 0",
   bankPackagePrice(athlete("no-session"), membershipById("no-session"), 0), 0);
eq("no membership at all is 0", bankPackagePrice(athlete("single-2", 80), null, 8), 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
