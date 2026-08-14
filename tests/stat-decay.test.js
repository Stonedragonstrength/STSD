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
  fnSrc(appSrc, "function statFloorFrac("),
  fnSrc(appSrc, "function statDecayFactor("),
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

console.log("");
if (failures) { console.log(`${failures} failing`); process.exit(1); }
console.log("all passing");
