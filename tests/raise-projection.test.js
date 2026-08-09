// raise-projection — the Raise fold's three readings of next month.
//
// COPY WARNING (see tests/README.md): this file re-states raiseProjection's
// formula from app.js. If you change the function, change this copy in the
// same commit — a green run against a stale copy is how the auto-renew grant
// drifted once already.
//
// The contract under test (Nathan's arithmetic, 2026-08-08):
//   left      = the bank RIGHT NOW (sessionBankSummary().remaining; may be
//               negative — sessions delivered unpaid)
//   projected = max(0, sessions − left) × rate          … the floor
//   hitsAll   = sessions × rate                          … bank burned by the 1st
//   missHalf  = max(0, sessions − carry) × rate, where
//               carry = ceil(left / 2) for left ≥ 0 (the odd session carries),
//               and the FULL debt for left < 0 (debt never halves)
//   Flat (program-only) tiers ignore the bank in all three readings.
//   All three read the live bank, so they move with every attended session
//   and meet on the 1st.
//
// Run: node tests/raise-projection.test.js

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  ok   " + name); return; }
  failures++;
  console.error("  FAIL " + name + (detail ? " -- " + detail : ""));
}

// The copy.
function project({ sessions, rate, left, flat = 0 }) {
  if (flat) return { projected: flat, hitsAll: flat, missHalf: flat, net: 0 };
  const price = (n) => Math.round(n * rate * 100) / 100;
  const carryHalf = left >= 0 ? Math.ceil(left / 2) : left;
  return {
    net: Math.max(0, sessions - left),
    projected: price(Math.max(0, sessions - left)),
    hitsAll: price(sessions),
    missHalf: price(Math.max(0, sessions - carryHalf)),
  };
}

console.log("-- buying minus holding, the row figure --");
{
  // Elise-shaped: buying 13 at $70, holding 3.
  const r = project({ sessions: 13, rate: 70, left: 3 });
  ok("floor is 10 × $70", r.projected === 700 && r.net === 10);
  ok("ceiling is the full buy", r.hitsAll === 910);
  ok("miss-half carries 2 of the 3 (odd one carries)", r.missHalf === 770);
}

console.log("-- the halfway number moves as the bank burns --");
{
  const day5 = project({ sessions: 16, rate: 70, left: 8 });
  const day20 = project({ sessions: 16, rate: 70, left: 2 });
  ok("early month: half of 8 carries", day5.missHalf === 840);
  ok("late month: half of 2 carries", day20.missHalf === 1050);
  ok("it climbs toward the ceiling", day20.missHalf > day5.missHalf && day20.missHalf <= day20.hitsAll);
}
{
  const closed = project({ sessions: 16, rate: 70, left: 0 });
  ok("on the 1st all three meet", closed.projected === 1120 && closed.missHalf === 1120 && closed.hitsAll === 1120);
}

console.log("-- a bank bigger than the buy floors at zero --");
{
  const r = project({ sessions: 4, rate: 70, left: 9 });
  ok("floor is $0, never negative", r.projected === 0);
  ok("miss-half also floors", r.missHalf === 0, String(r.missHalf));
  ok("ceiling still the full buy", r.hitsAll === 280);
}

console.log("-- debt adds to every reading, and never halves --");
{
  const r = project({ sessions: 13, rate: 70, left: -2 });
  ok("floor recovers the debt", r.projected === 1050);
  ok("miss-half keeps the whole debt", r.missHalf === 1050);
  ok("ceiling is untouched by debt", r.hitsAll === 910);
}

console.log("-- program-only stays flat in all three --");
{
  const r = project({ sessions: 0, rate: 0, left: 6, flat: 250 });
  ok("the bank never offsets a flat price", r.projected === 250 && r.hitsAll === 250 && r.missHalf === 250);
}

console.log("-- half-dollar rates keep their cents --");
{
  const r = project({ sessions: 9, rate: 85.5, left: 2 });
  ok("7 × $85.50 is exact", r.projected === 598.5);
  ok("8 × $85.50 is exact", r.missHalf === 684);
}

if (failures) { console.error("\n" + failures + " check(s) failed."); process.exit(1); }
console.log("\nall raise-projection checks passed.");
