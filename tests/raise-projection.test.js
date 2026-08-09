// raise-projection — the Raise fold's "what is next month worth" figure.
//
// COPY WARNING (see tests/README.md): this file re-states raiseProjection's
// formula from app.js. If you change the function, change this copy in the
// same commit — a green run against a stale copy is how the auto-renew grant
// drifted once already.
//
// The contract under test:
//   plan comes from monthChargePlan (the billing engine): gross, credit,
//   amount = max(0, gross − credit), rate, flat, sessions.
//   raiseProjection adds a PREVIEW of the credit this month's leftover would
//   become if the month closed today:
//     previewSessions = min(max(0, currentMonthLeft), creditCap)   [credits on]
//     previewValue    = min(max(0, gross − credit), round(previewSessions × rate))
//     projected       = max(0, amount − previewValue)
//   Flat tiers and credit-off athletes take no preview at all.
//
// Run: node tests/raise-projection.test.js

let failures = 0;
function ok(name, cond, detail) {
  if (cond) { console.log("  ok   " + name); return; }
  failures++;
  console.error("  FAIL " + name + (detail ? " -- " + detail : ""));
}

// The copy. Inputs flattened so each case states its whole world.
function project({ gross, credit = 0, rate, flat = false, sessions = 0,
                   creditsOn = true, currentLeft = 0, creditCap = Infinity }) {
  const amount = Math.max(0, gross - Math.min(credit, gross));
  let previewSessions = 0, previewValue = 0;
  if (!flat && creditsOn) {
    previewSessions = Math.min(Math.max(0, currentLeft), creditCap);
    previewValue = Math.min(
      Math.max(0, gross - credit),
      Math.round(previewSessions * rate),
    );
  }
  return { amount, previewSessions, previewValue,
    projected: Math.max(0, amount - previewValue) };
}

console.log("-- the leftover preview reduces next month's figure --");
{
  // Elise-shaped: 13 × $70 = $910, 3 left in the bank today.
  const r = project({ gross: 910, rate: 70, sessions: 13, currentLeft: 3 });
  ok("three left preview at $70 each", r.previewValue === 210);
  ok("projected is the bill minus the preview", r.projected === 700);
}

console.log("-- the preview can never exceed what is left of the invoice --");
{
  const r = project({ gross: 140, rate: 70, sessions: 2, currentLeft: 10 });
  ok("preview capped at the gross", r.previewValue === 140);
  ok("projected floors at zero, never negative", r.projected === 0);
}
{
  // Credit already ate most of the invoice; the preview only gets the rest.
  const r = project({ gross: 280, credit: 210, rate: 70, currentLeft: 4 });
  ok("cap is gross minus existing credit", r.previewValue === 70);
  ok("projected is zero once both credits land", r.projected === 0);
}

console.log("-- who gets no preview --");
{
  const r = project({ gross: 560, rate: 70, currentLeft: 5, creditsOn: false });
  ok("credits off: leftovers expire, full bill stands", r.projected === 560 && r.previewValue === 0);
}
{
  const r = project({ gross: 250, rate: 0, flat: true, currentLeft: 6 });
  ok("flat tier: sessions never offset a flat price", r.projected === 250 && r.previewValue === 0);
}

console.log("-- edges --");
{
  const r = project({ gross: 910, rate: 70, currentLeft: -2 });
  ok("a bank in debt previews nothing (the bill already stands)", r.previewValue === 0 && r.projected === 910);
}
{
  const r = project({ gross: 910, rate: 70, currentLeft: 9, creditCap: 4 });
  ok("the credit cap bounds the preview like it bounds the accrual", r.previewSessions === 4 && r.previewValue === 280);
}
{
  const r = project({ gross: 769.5, rate: 85.5, currentLeft: 1 });
  ok("half-dollar rates round once, like the accrual", r.previewValue === 86 && r.projected === 683.5);
}

if (failures) { console.error("\n" + failures + " check(s) failed."); process.exit(1); }
console.log("\nall raise-projection checks passed.");
