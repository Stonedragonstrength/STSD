// The monthly-allowance ledger, tested before it touches the UI. This decides
// what athletes owe, so every boundary gets an assertion.

function bankLedger(bank, todayMonth, rollover) {
  const packages = (bank && bank.packages) || [];
  const redemptions = (bank && bank.redemptions) || [];
  const monthOf = (p) => p.membershipGrant || p.autoRenewGrant || "";

  // Two kinds of package. A monthly grant carries the YYYY-MM it was for; a
  // pack the athlete bought outright carries nothing and never expires.
  const grantByMonth = new Map();
  let packPool = 0;
  packages.filter((p) => p.status === "paid").forEach((p) => {
    const size = Number(p.size) || 0;
    const mk = monthOf(p);
    if (mk) grantByMonth.set(mk, (grantByMonth.get(mk) || 0) + size);
    else packPool += size;
  });

  const usedByMonth = new Map();
  let undated = 0;
  redemptions.forEach((r) => {
    const mk = String((r && r.date) || "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(mk)) usedByMonth.set(mk, (usedByMonth.get(mk) || 0) + 1);
    else undated++;
  });

  let carried = 0;   // allowance surviving past months (rollover only)
  let expired = 0;   // allowance lost to month end
  let packUsed = undated; // a use we can't date has to come off something real

  const months = new Set([...grantByMonth.keys(), ...usedByMonth.keys()]);
  months.add(todayMonth);
  [...months].forEach((mk) => {
    const grant = grantByMonth.get(mk) || 0;
    const used = usedByMonth.get(mk) || 0;
    // The month's own allowance is always spent first, or it would sit there
    // expiring while a pack the athlete paid for drained instead.
    const left = Math.max(0, grant - used);
    packUsed += Math.max(0, used - grant);
    if (mk === todayMonth) return;          // still live, counted below
    if (mk > todayMonth) { carried += left; return; } // hasn't happened yet
    if (rollover) carried += left; else expired += left;
  });

  const thisMonthGrant = grantByMonth.get(todayMonth) || 0;
  const thisMonthUsed = usedByMonth.get(todayMonth) || 0;
  const thisMonth = Math.max(0, thisMonthGrant - thisMonthUsed);
  const banked = packPool + carried - packUsed;

  return {
    thisMonth, thisMonthGrant, thisMonthUsed,
    banked, expired,
    remaining: thisMonth + banked,
    granted: [...grantByMonth.values()].reduce((a, b) => a + b, 0) + packPool,
    used: redemptions.length,
  };
}

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log("  PASS " + label); }
  else { fail++; console.log(`  FAIL ${label}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};
const grant = (mk, size) => ({ id: "g" + mk, size, status: "paid", membershipGrant: mk });
const pack = (size) => ({ id: "p" + size, size, status: "paid" });
const uses = (mk, n) => Array.from({ length: n }, (_, i) => ({ id: mk + i, date: `${mk}-1${i}` }));

console.log("\n-- the case Nathan named: 4/month, uses 1 --");
{
  // Six months of a 4-session allowance, one session used each month.
  const b = { packages: [], redemptions: [] };
  ["2026-02","2026-03","2026-04","2026-05","2026-06","2026-07"].forEach((mk) => {
    b.packages.push(grant(mk, 4));
    b.redemptions.push(...uses(mk, 1));
  });
  const off = bankLedger(b, "2026-07", false);
  const on = bankLedger(b, "2026-07", true);
  eq("expiring: balance is this month only", off.remaining, 3);
  eq("expiring: five past months x 3 lost", off.expired, 15);
  eq("rolling: everything accumulates", on.remaining, 18);
  eq("rolling: nothing expires", on.expired, 0);
  eq("granted total is unchanged either way", [off.granted, on.granted], [24, 24]);
}

console.log("\n-- allowance is spent before a bought pack --");
{
  const b = { packages: [grant("2026-07", 4), pack(10)], redemptions: uses("2026-07", 3) };
  const r = bankLedger(b, "2026-07", false);
  eq("3 of the 4 allowance used", r.thisMonth, 1);
  eq("the 10-pack is untouched", r.banked, 10);
  eq("total reads 11", r.remaining, 11);
}

console.log("\n-- overflow past the allowance draws on the pack --");
{
  const b = { packages: [grant("2026-07", 4), pack(10)], redemptions: uses("2026-07", 6) };
  const r = bankLedger(b, "2026-07", false);
  eq("allowance emptied, not negative", r.thisMonth, 0);
  eq("2 came off the pack", r.banked, 8);
  eq("total reads 8", r.remaining, 8);
}

console.log("\n-- a bought pack NEVER expires --");
{
  const b = { packages: [pack(10), grant("2026-05", 4)], redemptions: [] };
  const r = bankLedger(b, "2026-07", false);
  eq("pack survives two months on", r.banked, 10);
  eq("only the old allowance expired", r.expired, 4);
  eq("no allowance this month", r.thisMonth, 0);
}

console.log("\n-- over-redeeming goes negative, which is a real debt --");
{
  const b = { packages: [grant("2026-07", 2)], redemptions: uses("2026-07", 5) };
  const r = bankLedger(b, "2026-07", false);
  eq("3 past the allowance", r.remaining, -3);
}

console.log("\n-- pending packages grant nothing until marked paid --");
{
  const b = { packages: [{ id: "x", size: 8, status: "pending", autoRenewGrant: "2026-07" }], redemptions: [] };
  eq("pending is worth 0", bankLedger(b, "2026-07", false).remaining, 0);
}

console.log("\n-- month boundary: last month's leftover is gone on the 1st --");
{
  const b = { packages: [grant("2026-06", 4)], redemptions: uses("2026-06", 1) };
  eq("standing in June, 3 left", bankLedger(b, "2026-06", false).remaining, 3);
  eq("standing in July, 0 left", bankLedger(b, "2026-07", false).remaining, 0);
  eq("standing in July with rollover, 3", bankLedger(b, "2026-07", true).remaining, 3);
}

console.log("\n-- December to January rollover of the YEAR --");
{
  const b = { packages: [grant("2026-12", 4), grant("2027-01", 4)], redemptions: uses("2026-12", 2) };
  const r = bankLedger(b, "2027-01", false);
  eq("January's own 4 are live", r.thisMonth, 4);
  eq("December's leftover 2 expired", r.expired, 2);
  eq("no accidental carry across the year", r.remaining, 4);
}

console.log("\n-- an undated redemption still costs something --");
{
  const b = { packages: [pack(5)], redemptions: [{ id: "u1" }, { id: "u2", date: "" }] };
  eq("both come off the pack", bankLedger(b, "2026-07", false).banked, 3);
}

console.log("\n-- a session redeemed for a FUTURE month doesn't expire early --");
{
  const b = { packages: [grant("2026-08", 4)], redemptions: uses("2026-08", 1) };
  const r = bankLedger(b, "2026-07", false);
  eq("next month's leftover 3 is carried, not expired", r.remaining, 3);
  eq("nothing expired", r.expired, 0);
}

console.log("\n-- an athlete with no bank at all --");
{
  eq("empty is zero", bankLedger({ packages: [], redemptions: [] }, "2026-07", false).remaining, 0);
  eq("undefined bank is zero", bankLedger(undefined, "2026-07", false).remaining, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
