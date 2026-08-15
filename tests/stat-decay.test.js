// The stat field's ledger and decay read — daysBetweenISO / syncStatField /
// readStatField. See docs/superpowers/specs/2026-08-13-stat-pentagon-design.md.
//
// Like the scoring test, this lifts the SHIPPED functions out of app.js rather
// than reimplementing them, and reads the decay constants from source so a
// retune shows up here instead of quietly passing against a stale copy.
//
// The failures it exists to catch, all of which are invisible in normal use:
//   1. Age measured with daysSince(), which compares against NOON — every axis
//      would visibly step down at lunchtime.
//   2. Decay applied per-open instead of per-day, so the value depends on how
//      often the athlete opened the app rather than how long since they trained.
//   3. A future-dated entry (typo, or a second device a timezone behind) hiding
//      the athlete's newest session and captioning it "days since you trained".
//   4. The floor missing, so an injured athlete's whole instrument drains away.
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function fnSrc(src, decl) {
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
function constSrc(src, name) {
  const at = src.indexOf(`const ${name} = `);
  if (at < 0) throw new Error(`not found: const ${name}`);
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") depth--;
    else if (c === ";" && !depth) return src.slice(at, i + 1);
  }
  throw new Error(`unterminated: const ${name}`);
}

const body = [
  constSrc(appSrc, "STAT_KEYS"),
  constSrc(appSrc, "STAT_DECAY"),
  constSrc(appSrc, "STAT_HORIZON_DAYS"),
  constSrc(appSrc, "STAT_FLOOR_BY_LEVEL"),
  fnSrc(appSrc, "function dateISO("),
  fnSrc(appSrc, "function daysBetweenISO("),
  // The whole-number clock and the memoised decay column. The peak walk
  // compares every banked day against every sample, so at a year of history
  // parsing two Dates per comparison measured 55ms per athlete — fine for the
  // athlete's own card, 1.2s of blocked main thread across a 22-athlete roster.
  fnSrc(appSrc, "function statDayIndex("),
  "let _statDecayTable = null;",
  fnSrc(appSrc, "function statFloorFrac("),
  fnSrc(appSrc, "function statDecayFactor("),
  fnSrc(appSrc, "function statDecayTable("),
  fnSrc(appSrc, "function readStatField("),
  "return { daysBetweenISO, statDecayFactor, statFloorFrac, readStatField, STAT_KEYS, STAT_DECAY, STAT_HORIZON_DAYS, STAT_FLOOR_BY_LEVEL };",
].join("\n\n");

const API = new Function(body)();
const { daysBetweenISO, statDecayFactor, statFloorFrac, readStatField,
        STAT_KEYS, STAT_DECAY, STAT_FLOOR_BY_LEVEL } = API;

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.log(`  FAIL ${label}\n       ${e.message}`); }
}
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);
// A field with one bucket of `amount` in `stat`, banked `ago` days before `today`.
function fieldAgo(stat, amount, ago, today) {
  const d = new Date(today + "T12:00:00");
  d.setDate(d.getDate() - ago);
  const key = d.toISOString().slice(0, 10);
  return { [key]: { [stat]: amount } };
}
const TODAY = "2026-08-13";
const NOVICE = { trainingLevel: "beginner" };

// ---- the date arithmetic ---------------------------------------------------

check("daysBetweenISO counts calendar days, both directions", () => {
  assert.strictEqual(daysBetweenISO("2026-08-13", "2026-08-13"), 0);
  assert.strictEqual(daysBetweenISO("2026-08-06", "2026-08-13"), 7);
  assert.strictEqual(daysBetweenISO("2026-08-13", "2026-08-06"), -7);
});

check("it does NOT flip at local noon, unlike daysSince()", () => {
  // daysSince(iso) compares Date.now() against noon of that day, so a 7-day-old
  // entry reads 6 in the morning and 7 in the afternoon. Every axis would step
  // down at lunch. daysBetweenISO takes two date STRINGS, so the time of day
  // cannot enter into it at all — which is the property being pinned here.
  const a = daysBetweenISO("2026-08-06", "2026-08-13");
  const b = daysBetweenISO("2026-08-06", "2026-08-13");
  assert.strictEqual(a, b);
  assert.strictEqual(a, 7, "seven calendar days is seven, at any hour");
});

check("it survives a daylight-saving boundary", () => {
  // Spring forward in most of the US is 2026-03-08. A naive (t2-t1)/86400000
  // yields 0.958 of a day and floors to the wrong answer.
  assert.strictEqual(daysBetweenISO("2026-03-07", "2026-03-09"), 2);
  assert.strictEqual(daysBetweenISO("2026-11-01", "2026-11-02"), 1);
});

// ---- the decay curve -------------------------------------------------------

check("every stat holds full value through its grace window", () => {
  STAT_KEYS.forEach((k) => {
    near(statDecayFactor(k, 0), 1, `${k} at day 0`);
    near(statDecayFactor(k, STAT_DECAY[k].grace), 1, `${k} at the end of grace`);
  });
});

check("one half-life past grace is worth half", () => {
  STAT_KEYS.forEach((k) => {
    const { grace, half } = STAT_DECAY[k];
    near(statDecayFactor(k, grace + half), 0.5, `${k} one half-life past grace`);
    near(statDecayFactor(k, grace + half * 2), 0.25, `${k} two half-lives past grace`);
  });
});

check("endurance fades fastest and condition slowest", () => {
  // The whole reason five clocks exist: at three weeks off the field should
  // TILT, not shrink evenly.
  const at21 = (k) => statDecayFactor(k, 21);
  assert.ok(at21("END") < at21("AGI"), "END should fade faster than AGI");
  assert.ok(at21("AGI") < at21("STR"), "AGI should fade faster than STR");
  assert.ok(at21("STR") < at21("CON"), "STR should fade faster than CON");
  assert.ok(at21("CON") === 1, "CON's grace is 21 days, so it has not moved yet");
});

check("strength holds for a fortnight, which is what the research says", () => {
  // Nathan's original 7-day figure was relocated to AGI. Max strength is the
  // most stubborn quality there is; it must not be visibly down at a week.
  near(statDecayFactor("STR", 7), 1, "STR at one week");
  near(statDecayFactor("STR", 14), 1, "STR at two weeks");
  assert.ok(statDecayFactor("STR", 30) < 1, "STR should be down by a month");
});

// ---- the read --------------------------------------------------------------

check("a bucket banked today reads at full value", () => {
  const p = { statField: fieldAgo("STR", 10, 0, TODAY) };
  const { cur, peak } = readStatField(NOVICE, p, TODAY);
  near(cur.STR, 10, "today's work is undecayed");
  near(peak.STR, 10, "and it is also the peak");
});

check("an untouched app for 40 days is correct on the FIRST paint", () => {
  // No catch-up pass, no missed ticks: the value is a function of (bucket, today),
  // so it cannot depend on how often the athlete opened the app.
  const p = { statField: fieldAgo("END", 10, 40, TODAY) };
  const { cur } = readStatField(NOVICE, p, TODAY);
  const expected = 10 * statDecayFactor("END", 40);
  const floor = 10 * statFloorFrac(NOVICE);
  near(cur.END, Math.max(expected, floor), "40 days of decay applied in one read");
});

check("the peak is a high-water mark and does not decay with the current value", () => {
  const p = { statField: fieldAgo("AGI", 20, 60, TODAY) };
  const { cur, peak } = readStatField(NOVICE, p, TODAY);
  assert.ok(peak.AGI >= 20 - 1e-6, "the peak remembers what was built");
  assert.ok(cur.AGI < peak.AGI, "the current value has receded from it");
});

check("nothing falls to zero: the floor is a fraction of the peak", () => {
  const p = { statField: fieldAgo("END", 10, 300, TODAY) };
  const { cur, peak } = readStatField(NOVICE, p, TODAY);
  const floor = statFloorFrac(NOVICE);
  assert.ok(cur.END > 0, "an injured athlete must not watch the instrument die");
  near(cur.END, peak.END * floor, "and it rests on the retained floor");
});

check("a longer-trained athlete keeps more", () => {
  const p = { statField: fieldAgo("STR", 10, 200, TODAY) };
  const novice = readStatField({ trainingLevel: "beginner" }, p, TODAY).cur.STR;
  const adv = readStatField({ trainingLevel: "advanced" }, p, TODAY).cur.STR;
  assert.ok(adv > novice, "training age should buy resistance to detraining");
});

check("a future-dated bucket is clamped to today, never discarded", () => {
  // The log-date chip has no max, and a second device a timezone ahead stamps
  // tomorrow. Dropping it would hide the newest session and show a day of decay
  // that did not happen.
  const p = { statField: fieldAgo("STR", 10, -3, TODAY) };
  const { cur } = readStatField(NOVICE, p, TODAY);
  near(cur.STR, 10, "tomorrow's session counts as today's, at full value");
});

check("buckets sum, and only the named stats are read", () => {
  const p = { statField: {
    [TODAY]: { STR: 4, CON: 2, h: "abc123" },   // `h` is the log fingerprint
  } };
  const { cur } = readStatField(NOVICE, p, TODAY);
  near(cur.STR, 4, "STR");
  near(cur.CON, 2, "CON");
  STAT_KEYS.forEach((k) => assert.strictEqual(typeof cur[k], "number", `${k} is a number`));
  assert.strictEqual(cur.h, undefined, "the fingerprint must not become a stat");
});

check("an empty or missing field reads as all zeros, not NaN", () => {
  [{}, { statField: {} }, { statField: null }, null].forEach((p) => {
    const { cur, peak } = readStatField(NOVICE, p, TODAY);
    STAT_KEYS.forEach((k) => {
      assert.ok(Number.isFinite(cur[k]), `cur.${k} finite for ${JSON.stringify(p)}`);
      assert.ok(Number.isFinite(peak[k]), `peak.${k} finite for ${JSON.stringify(p)}`);
    });
  });
});

check("malformed buckets are skipped rather than poisoning the sum", () => {
  const p = { statField: {
    "not-a-date": { STR: 5 },
    [TODAY]: { STR: "seven", CON: 3 },
  } };
  const { cur } = readStatField(NOVICE, p, TODAY);
  STAT_KEYS.forEach((k) => assert.ok(Number.isFinite(cur[k]), `${k} stayed finite`));
});

// ---- the calibration -------------------------------------------------------
// STAT_FULL decides what the pentagon SHOWS, and it is the one number here that
// cannot be derived — it was simulated at first and was 3-6x too high on every
// axis, so the whole roster read 1-8% of full and the field was a dot.
//
// These rates are MEASURED, from the four athletes who had opened their Progress
// tab on 2026-08-14: 21 sessions over 77 athlete-days, 1.9 sessions a week.
// "typical" is the mean banked per session; "committed" is the best single
// session value we have actually seen. Both are per-session values.
//
// END AND CON ARE DELIBERATELY EXCLUDED FROM THIS TABLE, for the same reason:
// this model assumes ONE per-SESSION frequency, and neither axis is banked per
// session. END's primary input is cardio, which the 08-14 sample contained none
// of and which has no recovery ceiling on frequency. CON is banked on every
// training day INCLUDING cardio-only ones, so the roster banks it 2.0-5.5 days
// a week rather than 1.9. Both are re-measured below against their own rates.
//
// STR and DEX stay here because they ARE per-session, they were measured on
// athletes doing the thing that feeds them, and nobody is near their ceiling
// (roster max 23% and 35% respectively).
const MEASURED_2026_08_14 = {
  perWeek: 1.9,
  typical:   { STR: 2.73, AGI: 0, DEX: 0.51 },
  committed: { STR: 5.90, AGI: 0, DEX: 1.60 },
};

// END, re-measured 2026-08-15 against production after Cheryl Ray pegged the
// axis at 112% of full. See the STAT_FULL comment in app.js for the full story.
//
// The anchor is a HABIT rather than a best-ever day, because END is the one axis
// with no recovery ceiling on how often it can be banked: "best day, every day"
// is a fair definition of full for a squat and an absurd one for a walk. 45 min
// of moderate cardio, 5 days a week, sustained — 7.2 points a day at 0.16/min.
const MEASURED_END_2026_08_15 = {
  daysPerWeek: 5,
  committed: 7.2,   // 45 min moderate
  typical: 1.1,     // roster mean END/day, cardio athlete included
};

// CON, raised 2026-08-15 for the opposite reason to END's: not because anyone
// had pegged it, but because PROJECTING each athlete's current habit to its
// plateau put four of them through the ceiling — Cheryl 541, Jeff 401, Alyssa
// 384, Kristyn 380 against a full of 330. The roster reads 12-35% today only
// because it is three weeks old, which hid it.
//
// CON is the one axis where athletes already hit the 13/day cap, so "committed"
// is that cap. 2.7 days a week is the roster's real CON-banking frequency for a
// consistent athlete — higher than the 1.9 SESSIONS/week the 08-14 model
// assumes, because CON banks on cardio-only days too.
const MEASURED_CON_2026_08_15 = {
  perWeek: 2.7,
  committed: 13.0,  // the daily cap, which CON days genuinely reach
  typical: 8.5,     // roster mean CON on a day it is banked at all
};
const STAT_FULL = (() => {
  const m = appSrc.match(/const STAT_FULL = \{[^}]*\}/);
  if (!m) throw new Error("STAT_FULL not found in app.js");
  return eval("(" + m[0].replace("const STAT_FULL = ", "") + ")");
})();

// Train at a fixed per-session rate forever and read where it settles.
function plateau(rate, days = 400) {
  const gap = Math.max(1, Math.round(7 / MEASURED_2026_08_14.perWeek));
  const field = {};
  const start = new Date("2026-01-01").getTime();
  for (let d = 0; d < days; d += gap) {
    const b = {};
    Object.keys(rate).forEach((k) => { if (rate[k] > 0) b[k] = rate[k]; });
    field[new Date(start + d * 86400000).toISOString().slice(0, 10)] = b;
  }
  const end = new Date(start + days * 86400000).toISOString().slice(0, 10);
  return readStatField(NOVICE, { statField: field }, end).cur;
}

check("the field settles at a plateau rather than creeping forever", () => {
  // The property the whole calibration rests on: decay eventually balances
  // accrual, so an axis measures how hard and how often someone trains, not how
  // long they have been on the books. Without it, everyone reaches full by
  // simply continuing to exist and the instrument stops saying anything.
  const at400 = plateau(MEASURED_2026_08_14.committed, 400);
  const at800 = plateau(MEASURED_2026_08_14.committed, 800);
  Object.keys(MEASURED_2026_08_14.committed).forEach((k) => {
    if (!(MEASURED_2026_08_14.committed[k] > 0)) return;
    assert.ok(Math.abs(at800[k] - at400[k]) < at400[k] * 0.02,
      `${k} still climbing between 400 and 800 days: ${at400[k].toFixed(1)} -> ${at800[k].toFixed(1)}`);
  });
});

// A plateau at a FRACTIONAL weekly rate, for the two axes that are not banked
// per session. plateau() above rounds 7/perWeek to whole days, which cannot
// express 5 a week (7/5 rounds to 1 — that is 7 a week, a third too much) or
// 2.7 (rounds to 3, i.e. 2.3). Stepping a float cursor and rounding to a date
// keeps the average rate honest. Kept separate so STR and DEX keep the exact
// model they were calibrated under.
function plateauAtRate(stat, perDay, perWeek, days = 700) {
  const field = {};
  const start = new Date("2026-01-01").getTime();
  const gap = 7 / perWeek;
  for (let t = 0; t < days; t += gap) {
    field[new Date(start + Math.round(t) * 86400000).toISOString().slice(0, 10)] = { [stat]: perDay };
  }
  const end = new Date(start + days * 86400000).toISOString().slice(0, 10);
  return readStatField(NOVICE, { statField: field }, end).cur[stat];
}

check("CON: the most consistent athlete on the roster fits under the ceiling", () => {
  const m = MEASURED_CON_2026_08_15;
  const committedPct = (plateauAtRate("CON", m.committed, m.perWeek) / STAT_FULL.CON) * 100;
  assert.ok(committedPct >= 85 && committedPct <= 115,
    `a capped CON day at ${m.perWeek}/wk reads ${committedPct.toFixed(0)}% of CON`);

  // The regression this guards, and the reason it is not the same shape as the
  // others: CON's failure was invisible in the CURRENT reading and only showed
  // in the PROJECTION. These are the four real habits that went through 330.
  // A three-week-old roster reading 12-35% is not evidence the ceiling is safe.
  [["Cheryl Ray", 6.4, 5.5], ["Jeff Beltran", 11.0, 2.3],
   ["Alyssa Murphy", 10.0, 2.5], ["Kristyn Judkins", 11.9, 2.0]].forEach(([who, perDay, perWeek]) => {
    const pct = (plateauAtRate("CON", perDay, perWeek) / STAT_FULL.CON) * 100;
    assert.ok(pct <= 100,
      `${who}'s current habit projects to ${pct.toFixed(0)}% of CON — it pegs, and a pegged axis stops measuring the athletes who earned it`);
  });
});

check("END: a committed cardio habit reaches full, and it is not reachable without cardio", () => {
  const m = MEASURED_END_2026_08_15;
  const committedPct = (plateauAtRate("END", m.committed, m.daysPerWeek) / STAT_FULL.END) * 100;
  assert.ok(committedPct >= 85 && committedPct <= 115,
    `45 min of moderate cardio 5 d/wk reads ${committedPct.toFixed(0)}% of END — full is the plateau of that habit, no easier and no harder`);

  // The regression that caused this recalibration: END full must NOT be
  // reachable by gym rep-band work alone. The whole roster except one athlete
  // banks END only that way, and the best day any of them has ever posted is
  // 1.6. If that plateaus anywhere near full, the axis has been calibrated on
  // people who do not train it — which is exactly how it shipped at 35.
  const gymOnly = (plateauAtRate("END", 1.6, 2) / STAT_FULL.END) * 100;
  assert.ok(gymOnly < 25,
    `26+ rep gym work alone plateaus at ${gymOnly.toFixed(0)}% of END — END is the aerobic engine, and it cannot be filled without conditioning`);

  // And one session must not be worth a big slice of a sustained plateau. At
  // the old constant a single hour of moderate cardio was 27% of full, which is
  // the shape of the error rather than its size.
  const oneHour = (9.6 / STAT_FULL.END) * 100;
  assert.ok(oneHour < 10,
    `one 60-min moderate session is ${oneHour.toFixed(0)}% of full END in a single day — full is a sustained plateau, not a few sessions`);
});

check("a committed athlete reaches full, and a typical one lands mid-field", () => {
  // Both directions matter. Too high and the pentagon is a dot nobody can move
  // (which is what shipped first). Too low and everyone pegs at 100% and it
  // stops distinguishing anyone.
  const pc = plateau(MEASURED_2026_08_14.committed);
  const pt = plateau(MEASURED_2026_08_14.typical);
  Object.keys(MEASURED_2026_08_14.committed).forEach((k) => {
    if (!(MEASURED_2026_08_14.committed[k] > 0)) return;   // AGI: no data, see app.js
    const committedPct = (pc[k] / STAT_FULL[k]) * 100;
    const typicalPct = (pt[k] / STAT_FULL[k]) * 100;
    assert.ok(committedPct >= 85 && committedPct <= 115,
      `a committed athlete reads ${committedPct.toFixed(0)}% on ${k} — full should be reachable by sustaining the best session we have seen, and no easier`);
    assert.ok(typicalPct <= committedPct,
      `${k}: a typical athlete (${typicalPct.toFixed(0)}%) cannot outread a committed one (${committedPct.toFixed(0)}%)`);
  });
});

check("AGI is the one axis with no data, and app.js says so", () => {
  // Every athlete on the roster has AGI zero and always has: nothing currently
  // programmed banks it, because the builder writes no Speed/Agility or plyo.
  // If that stops being true the axis needs re-measuring, so the comment that
  // says so must not quietly disappear.
  assert.strictEqual(MEASURED_2026_08_14.committed.AGI, 0);
  const at = appSrc.indexOf("const STAT_FULL = {");
  const note = appSrc.slice(Math.max(0, at - 1600), at);
  assert.ok(/AGI IS NOT CALIBRATED/.test(note),
    "app.js no longer records that AGI is uncalibrated — re-measure it or keep the warning");
});

console.log("");
if (failures) { console.log(`${failures} failing`); process.exit(1); }
console.log("all passing");
