// What the monthly auto-renew ticket is worth. This is the number the coach
// bills from, and it had no test — which is how a 12-session athlete ended up
// with a 3-session ticket for $255 and stayed there for the month.
//
// Mirrors the branch structure of runAutoRenewGrants() in app.js. If you change
// the original, change this copy too, or the test is guarding nothing.

const MEMBERSHIPS = [
  { id: "single-1", sessions: 4, price: 400 },
  { id: "single-2", sessions: 8, price: 725 },
  { id: "single-3", sessions: 12, price: 1020 },
  { id: "single-4", sessions: 16, price: 1320 },
  { id: "couples-1", sessions: 4, price: 550 },
  { id: "monthly-2", sessions: 2 },
  { id: "no-session", sessions: 0 },
];
const membershipById = (id) => MEMBERSHIPS.find((m) => m.id === id) || null;

// app.js: membershipPerSession / athleteSessionRate. A rate typed on the bank
// beats the tier; without one the tier's own per-session figure IS the rate,
// which is why an athlete on no custom rate still prices at exactly list.
function athleteSessionRate(bank) {
  const own = Number(bank?.rate);
  if (own > 0) return own;
  const m = membershipById(bank?.membership || "");
  return m && m.price && m.sessions ? m.price / m.sessions : 0;
}
// app.js: bankPackagePrice. Rounded to CENTS at the end, never per-session —
// real rates carry half-dollars and rounding 137.50 first invents money.
function bankPackagePrice(bank, m, size) {
  if (!m) return 0;
  if (!m.sessions) return Number(m.price) || 0;
  const given = Number(size);
  const n = Number.isFinite(given) && given >= 0 ? given : m.sessions;
  return Math.round(athleteSessionRate(bank) * n * 100) / 100;
}
const pkgOwed = (p) => !!p && (!!p.unpaid || p.status === "pending");

// The month's package, whichever route put it there (app.js: monthPackageOf).
function monthPackageOf(bank, key) {
  return (bank?.packages || [])
    .find((p) => p.membershipGrant === key || p.autoRenewGrant === key) || null;
}

// Bookings for the whole BANK. A couple shares one allowance, but the slot they
// share is booked under one of them, so counting a single half reads 12 for him
// and 1 for her off the same thirteen sessions.
function bookedForBank(events, monthKey, client, partner) {
  return events.filter((e) =>
    e.month === monthKey && (e.who === client || (!!partner && e.who === partner))
  ).length;
}

// One athlete's pass. Pure, so the decision can be asserted without a calendar.
// `booked` is what the calendar holds for the month right now.
function planAutoRenew(bank, key, booked) {
  if (!bank?.autoRenew) return { action: "off" };
  const m = membershipById(bank.membership);
  if (!m || !m.sessions) return { action: "no-tier" };
  const existing = monthPackageOf(bank, key);
  if (existing) {
    if (!existing.autoRenewGrant) return { action: "manual" };
    // A rate set AFTER the grant used to be invisible: the package keeps the
    // price stamped the day it ran, and owedAmount sums that stamped number.
    // Corrected only while the money is still OUTSTANDING -- a settled month is
    // what was actually collected -- and never over a figure the coach typed.
    const due = bankPackagePrice(bank, m, existing.size);
    const reprice = pkgOwed(existing) && existing.priceSetBy !== "coach" &&
      due > 0 && due !== Number(existing.price);
    if (existing.booked === booked) {
      return reprice ? { action: "reprice", price: due } : { action: "steady" };
    }
    return reprice ? { action: "advise", booked, price: due } : { action: "advise", booked };
  }
  return { action: "grant", size: m.sessions, price: bankPackagePrice(bank, m, m.sessions), booked };
}

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}
const bank = (membership, over = {}) =>
  ({ autoRenew: true, membership, packages: [], ...over });
const arPkg = (over = {}) =>
  ({ id: "ar", size: 8, price: 725, status: "paid", unpaid: true, autoRenewGrant: "2026-08", booked: 8, ...over });

console.log("-- the ticket is the membership, not the calendar --");
{
  // The bug this replaced: Ursula, single-3, opened on the 3rd with three
  // one-offs booked, billed 3 × $85 = $255 against a $1,020 membership.
  eq("12-session tier, 3 booked → still the 12-session ticket",
    planAutoRenew(bank("single-3"), "2026-08", 3),
    { action: "grant", size: 12, price: 1020, booked: 3 });
  eq("16-session tier, 1 booked → still the 16-session ticket",
    planAutoRenew(bank("single-4"), "2026-08", 1),
    { action: "grant", size: 16, price: 1320, booked: 1 });
}

console.log("\n-- booking over the tier doesn't raise the bill --");
{
  // The coach bills the membership rate for 9 sessions on an 8-session
  // membership. The old code charged 9 × $91 = $819.
  eq("9 booked on an 8-session tier is still $725",
    planAutoRenew(bank("single-2"), "2026-08", 9),
    { action: "grant", size: 8, price: 725, booked: 9 });
}

console.log("\n-- an empty calendar still gets an invoice --");
{
  // Three paying members had 0 booked and were silently skipped, so the coach
  // never saw a ticket to collect against.
  eq("0 booked, still billed for the membership",
    planAutoRenew(bank("single-3"), "2026-08", 0),
    { action: "grant", size: 12, price: 1020, booked: 0 });
}

console.log("\n-- the booked count is advisory, and only written when it moves --");
{
  const b = bank("single-2", { packages: [arPkg({ booked: 8 })] });
  eq("unchanged count is a no-op", planAutoRenew(b, "2026-08", 8), { action: "steady" });
  eq("a new booking updates the count", planAutoRenew(b, "2026-08", 9),
    { action: "advise", booked: 9 });
  eq("a cancellation updates it too", planAutoRenew(b, "2026-08", 7),
    { action: "advise", booked: 7 });
}
{
  // Advising never reopens size or price — that is the whole point of the split.
  const pkg = arPkg({ booked: 8 });
  const b = bank("single-2", { packages: [pkg] });
  planAutoRenew(b, "2026-08", 13);
  eq("size untouched by the advisory", pkg.size, 8);
  eq("price untouched by the advisory", pkg.price, 725);
}

console.log("\n-- a collected ticket is settled --");
{
  // Money already taken. Nothing about it moves except the advisory count.
  const b = bank("single-2", { packages: [arPkg({ unpaid: undefined, paidAt: 1, booked: 8 })] });
  eq("still only advises", planAutoRenew(b, "2026-08", 12), { action: "advise", booked: 12 });
}

console.log("\n-- a manual grant is the coach's own number --");
{
  const b = bank("single-3", { packages: [{ id: "m", size: 12, status: "paid", membershipGrant: "2026-08" }] });
  eq("left alone over the tier", planAutoRenew(b, "2026-08", 15), { action: "manual" });
  eq("left alone under it", planAutoRenew(b, "2026-08", 4), { action: "manual" });
}

console.log("\n-- nothing to grant --");
{
  eq("program-only tier grants nothing",
    planAutoRenew(bank("no-session"), "2026-08", 3), { action: "no-tier" });
  eq("no membership set grants nothing",
    planAutoRenew(bank(""), "2026-08", 3), { action: "no-tier" });
  eq("opted out", planAutoRenew(bank("single-2", { autoRenew: false }), "2026-08", 9),
    { action: "off" });
}

console.log("\n-- a tier with no price still grants its sessions --");
{
  // Priced through bankPackagePrice now, not stamped from m.price -- a tier
  // with no price has no rate to multiply, so the ticket is worth nothing and
  // the sessions are the point. (This assertion said `undefined` for a while
  // after the app moved to bankPackagePrice: the copy had drifted.)
  eq("monthly-2 carries no price", planAutoRenew(bank("monthly-2"), "2026-08", 2),
    { action: "grant", size: 2, price: 0, booked: 2 });
}

console.log("\n-- a rate set AFTER the grant re-prices what is still owed --");
{
  // The real one. A couple on couples-1 were granted August at $138 a session
  // (4 x 138 = $552), then moved to a negotiated $125. The grant keeps the
  // price stamped on the day it ran and every "still to collect" total sums
  // that stamped number, so they went on being chased for $552 against a $500
  // month with nothing on screen admitting the two disagreed.
  const b = bank("couples-1", { rate: 125, packages: [arPkg({ size: 4, price: 552, booked: 4 })] });
  eq("the stale $552 is corrected to $500", planAutoRenew(b, "2026-08", 4),
    { action: "reprice", price: 500 });
}
{
  // Both things can move at once, and the pass must not have to choose.
  const b = bank("couples-1", { rate: 125, packages: [arPkg({ size: 4, price: 552, booked: 4 })] });
  eq("a new booking and a new rate together", planAutoRenew(b, "2026-08", 5),
    { action: "advise", booked: 5, price: 500 });
}
{
  // Money already in hand is history. Re-pricing a settled month would rewrite
  // what was actually collected, which is worse than showing a stale figure.
  const b = bank("couples-1", { rate: 125,
    packages: [arPkg({ size: 4, price: 552, booked: 4, unpaid: undefined, paidAt: 1 })] });
  eq("a collected ticket is never re-priced", planAutoRenew(b, "2026-08", 4),
    { action: "steady" });
}
{
  // A number the coach typed is theirs. Without this guard the next calendar
  // load quietly undoes their correction.
  const b = bank("couples-1", { rate: 125,
    packages: [arPkg({ size: 4, price: 480, booked: 4, priceSetBy: "coach" })] });
  eq("a hand-typed price is left alone", planAutoRenew(b, "2026-08", 4), { action: "steady" });
}
{
  // No rate change, no write. This runs on every calendar load and a write per
  // load is a cloud push per load.
  const b = bank("couples-1", { packages: [arPkg({ size: 4, price: 550, booked: 4 })] });
  eq("a price that already agrees is a no-op", planAutoRenew(b, "2026-08", 4),
    { action: "steady" });
}
{
  // A manual grant is the coach's own number end to end -- it never even
  // reaches the re-price branch.
  const b = bank("couples-1", { rate: 125,
    packages: [{ id: "m", size: 4, price: 552, status: "paid", unpaid: true, membershipGrant: "2026-08" }] });
  eq("a manual grant stays manual", planAutoRenew(b, "2026-08", 4), { action: "manual" });
}
{
  // Half-dollar rates are why the rounding happens once, at the end: 85.50 x 9
  // is $769.50, and rounding the rate first bills $770.
  const b = bank("single-3", { rate: 85.5, packages: [arPkg({ size: 9, price: 1020, booked: 9 })] });
  eq("cents survive the re-price", planAutoRenew(b, "2026-08", 9),
    { action: "reprice", price: 769.5 });
}

console.log("\n-- a couple is one bank, so it is one count --");
{
  // Kevin + Sarah: thirteen sessions between them, twelve booked under him and
  // one under her. Counting her half alone said "1 booked" against a
  // 16-session allowance and read as an athlete about to quit.
  const ev = [
    ...Array(12).fill(0).map(() => ({ month: "2026-08", who: "kevin" })),
    { month: "2026-08", who: "sarah" },
    { month: "2026-07", who: "kevin" }, // last month, never counted
  ];
  eq("counted from his side", bookedForBank(ev, "2026-08", "kevin", "sarah"), 13);
  eq("counted from hers, same answer", bookedForBank(ev, "2026-08", "sarah", "kevin"), 13);
  eq("without the link, only her own", bookedForBank(ev, "2026-08", "sarah", null), 1);
}
{
  // Both halves agreeing is what stops them overwriting each other's count and
  // pushing to the cloud on every calendar load.
  const ev = [{ month: "2026-08", who: "a" }, { month: "2026-08", who: "b" }];
  eq("both halves settle on the same number",
    bookedForBank(ev, "2026-08", "a", "b"), bookedForBank(ev, "2026-08", "b", "a"));
}

console.log("\n-- last month's ticket doesn't answer for this one --");
{
  const b = bank("single-2", { packages: [arPkg({ autoRenewGrant: "2026-07" })] });
  eq("August starts fresh", planAutoRenew(b, "2026-08", 5),
    { action: "grant", size: 8, price: 725, booked: 5 });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
