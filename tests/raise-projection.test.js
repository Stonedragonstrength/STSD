// raise-projection — the Raise fold's two readings of next month.
//
// COPY WARNING (see tests/README.md): this file re-states raiseProjection's
// formula from app.js. If you change the function, change this copy in the
// same commit — a green run against a stale copy is how the auto-renew grant
// drifted once already.
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
// Run: node tests/raise-projection.test.js

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  ok   " + name); return; }
  failures++;
  console.error("  FAIL " + name + (detail ? " -- " + detail : ""));
}

// The copy.
function project({ sessions, rate, left, flat = 0 }) {
  if (flat) return { projected: flat, hitsAll: flat, net: 0 };
  const price = (n) => Math.round(n * rate * 100) / 100;
  return {
    net: Math.max(0, sessions - left),
    projected: price(Math.max(0, sessions - left)),
    hitsAll: price(sessions),
  };
}

console.log("-- buying minus holding, the row figure --");
{
  // Elise-shaped: buying 13 at $70, holding 3.
  const r = project({ sessions: 13, rate: 70, left: 3 });
  ok("projected is 10 × $70", r.projected === 700 && r.net === 10);
  ok("ceiling is the full buy", r.hitsAll === 910);
}

console.log("-- the projection climbs as the bank burns --");
{
  const day5 = project({ sessions: 16, rate: 70, left: 8 });
  const day20 = project({ sessions: 16, rate: 70, left: 2 });
  const day31 = project({ sessions: 16, rate: 70, left: 0 });
  ok("mid-month it sits under the ceiling", day5.projected === 560 && day5.projected < day5.hitsAll);
  ok("it climbs with every attended session", day20.projected === 980 && day20.projected > day5.projected);
  ok("on the 1st the two readings meet", day31.projected === 1120 && day31.projected === day31.hitsAll);
}

console.log("-- a bank bigger than the buy floors at zero --");
{
  const r = project({ sessions: 4, rate: 70, left: 9 });
  ok("projected is $0, never negative", r.projected === 0);
  ok("ceiling still the full buy", r.hitsAll === 280);
}

console.log("-- debt adds to the projection, never the ceiling --");
{
  const r = project({ sessions: 13, rate: 70, left: -2 });
  ok("projected recovers the debt", r.projected === 1050);
  ok("ceiling is untouched by debt", r.hitsAll === 910);
}

console.log("-- program-only stays flat in both --");
{
  const r = project({ sessions: 0, rate: 0, left: 6, flat: 250 });
  ok("the bank never offsets a flat price", r.projected === 250 && r.hitsAll === 250);
}

console.log("-- half-dollar rates keep their cents --");
{
  const r = project({ sessions: 9, rate: 85.5, left: 2 });
  ok("7 × $85.50 is exact", r.projected === 598.5);
  ok("9 × $85.50 is exact", r.hitsAll === 769.5);
}

if (failures) { console.error("\n" + failures + " check(s) failed."); process.exit(1); }
console.log("\nall raise-projection checks passed.");
