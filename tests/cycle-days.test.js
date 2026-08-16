// The span editor behind the cycle calendar: `cycleToggleDay` and the
// `cycleBleedDays` set the grid paints from.
//
// The old card asked for two events days apart — "Period started", then
// "It's ended" — and the end tap was the one nobody made. Six things then
// degraded quietly: the bleed length fell back to a 5-day guess, the
// period→follicular boundary became an estimate, the chart shaded a phantom
// band, the history row read "open" forever, and `cycleLogEnd` would happily
// stamp a 60-day bleed two months later because it only checked `d >= start`.
//
// The calendar removes the second event rather than reminding people to make
// it: the days you tapped ARE the period, and `end` is always written. So the
// whole feature now rests on one pure function getting span arithmetic right,
// and getting it wrong is silent — a dropped day just isn't red any more, and
// a corrupted span quietly re-dates every cycle length after it.
//
// The cases that earn this file are the ones a hand-test never reaches: a tap
// that BRIDGES two spans (merge), a tap in the MIDDLE of one (split, which has
// to mint a genuinely new id or two runs share an identity), and a tap on a
// legacy `end: null` record written by the old build or by a cached PWA that
// is still running it. That last one is the migration: there is none. Old
// records are read through the same inference `cyclePhaseOn` already uses, and
// materialised the first time a finger lands on them.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

// Brace-match a function out of the live source, so these tests run the code
// that ships rather than a copy that drifts. Same helper as
// merge-exercise-logs.test.js and template-tombstones.test.js.
function fnSrc(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`not found in app.js: ${decl}`);
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error(`unbalanced: ${decl}`);
}

const NEEDED = [
  "function dateISO(",
  "function addDaysISO(",
  "function cycleDaysBetween(",
  "function cycleSortedPeriods(",
  "function cycleStarts(",
  "function cycleLengths(",
  "function cycleAvgLength(",
  "function cycleLenOrDefault(",
  "function cycleLearning(",
  "function cycleBleedLength(",
  "function cycleBleedEnd(",
  "function cycleBleedDays(",
  "function cycleToggleDay(",
  "function cycleNextStart(",
  "function cycleNudgeFor(",
];

// The CYCLE_* thresholds are lifted from the source rather than restated, so
// retuning one in app.js retunes the test with it instead of quietly leaving
// this file asserting last month's numbers.
const consts = appSrc.match(/^\s*const CYCLE_(?:DEFAULT_LEN|DEFAULT_BLEED|MIN_LEN|MAX_LEN|LATE_DAYS|GAP_DAYS|NUDGE_BEFORE|NUDGE_AFTER)\s*=\s*\d+;/gm) || [];
if (consts.length < 8) throw new Error(`expected 8 CYCLE_* constants in app.js, found ${consts.length}`);

// `uid()` is stubbed rather than extracted: the real one is Date.now-based and
// these tests need to assert that a split mints a DISTINCT id, which a
// same-millisecond pair would fail on by luck rather than by logic.
// cycleNudgeSeen() reads localStorage in the app; here it is a settable stub so
// the dismissal can be driven from a test without a DOM.
const sandbox = new Function(`
  ${consts.join("\n")}
  let __uid = 0;
  function uid() { return "u" + (++__uid); }
  let __nudgeSeen = "";
  function cycleNudgeSeen() { return __nudgeSeen; }
  ${NEEDED.map((d) => fnSrc(appSrc, d)).join("\n")}
  return { cycleBleedDays, cycleToggleDay, cycleBleedEnd, cycleLengths, cycleStarts,
           cycleSortedPeriods, cycleDaysBetween, addDaysISO, cycleNextStart,
           cycleNudgeFor, cycleLearning,
           setNudgeSeen: (v) => { __nudgeSeen = v || ""; } };
`)();

const { cycleBleedDays, cycleToggleDay, cycleBleedEnd, cycleLengths, cycleSortedPeriods } = sandbox;

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.log(`  FAIL ${label}\n       ${e.message}`); }
}

const P = (start, end, flow) => ({ id: "p" + start, start, end: end === undefined ? start : end, flow: flow || null });
const days = (list) => [...cycleBleedDays(list)].sort();
const spans = (list) => cycleSortedPeriods(list).map((p) => `${p.start}..${p.end}`);

// A span is only ever valid if it is ordered, and two spans may never touch:
// contiguous runs have to be ONE record or the day count and the cycle-length
// series both read the same period twice.
function assertWellFormed(list, label) {
  const sorted = cycleSortedPeriods(list);
  sorted.forEach((p) => {
    assert.ok(p.end, `${label}: every record the calendar writes must carry an end (${p.start})`);
    assert.ok(p.end >= p.start, `${label}: end before start (${p.start}..${p.end})`);
    assert.ok(p.id, `${label}: record without an id`);
  });
  const ids = sorted.map((p) => p.id);
  assert.strictEqual(new Set(ids).size, ids.length, `${label}: duplicate ids`);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sandbox.cycleDaysBetween(sorted[i - 1].end, sorted[i].start);
    assert.ok(gap > 1, `${label}: spans touch or overlap (${spans(list).join(", ")})`);
  }
}

console.log("\ncycleBleedDays — which squares are red");

check("a closed span covers every day from start to end inclusive", () => {
  assert.deepStrictEqual(days([P("2026-08-03", "2026-08-07")]),
    ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]);
});

check("a one-day span covers exactly that day", () => {
  assert.deepStrictEqual(days([P("2026-08-03", "2026-08-03")]), ["2026-08-03"]);
});

check("several spans union, and stay sorted", () => {
  const list = [P("2026-07-06", "2026-07-08"), P("2026-08-03", "2026-08-04")];
  assert.deepStrictEqual(days(list),
    ["2026-07-06", "2026-07-07", "2026-07-08", "2026-08-03", "2026-08-04"]);
});

check("a legacy end:null record is inferred, not dropped", () => {
  // The old build's "Period started" with no "It's ended". Two closed 4-day
  // records set the learned bleed length, so the open one reads as 4 days --
  // the same inference cyclePhaseOn and cycleBands already make. Dropping it
  // instead would blank a period out of the athlete's history.
  const list = [
    P("2026-06-06", "2026-06-09"),
    P("2026-07-06", "2026-07-09"),
    { id: "open", start: "2026-08-03", end: null, flow: null },
  ];
  assert.deepStrictEqual(days(list).filter((d) => d >= "2026-08-01"),
    ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]);
});

check("an end:null record with no history falls back to the 5-day default", () => {
  const list = [{ id: "open", start: "2026-08-03", end: null, flow: null }];
  assert.strictEqual(days(list).length, 5);
  assert.strictEqual(cycleBleedEnd(list[0], list), "2026-08-07");
});

console.log("\ncycleToggleDay — adding a day");

check("tapping an untouched day makes a new one-day span", () => {
  const out = cycleToggleDay([], "2026-08-03");
  assert.deepStrictEqual(days(out), ["2026-08-03"]);
  assertWellFormed(out, "new span");
});

check("tapping the day after a span extends it forward", () => {
  const out = cycleToggleDay([P("2026-08-03", "2026-08-05")], "2026-08-06");
  assert.deepStrictEqual(spans(out), ["2026-08-03..2026-08-06"]);
  assertWellFormed(out, "extend forward");
});

check("tapping the day before a span extends it backward", () => {
  // The "it actually started yesterday" correction, which the old card could
  // only express by logging a second period and resetting the day counter.
  const out = cycleToggleDay([P("2026-08-03", "2026-08-05")], "2026-08-02");
  assert.deepStrictEqual(spans(out), ["2026-08-02..2026-08-05"]);
  assertWellFormed(out, "extend backward");
});

check("a tap that bridges two spans merges them into one", () => {
  const out = cycleToggleDay([P("2026-08-03", "2026-08-04"), P("2026-08-06", "2026-08-07")], "2026-08-05");
  assert.deepStrictEqual(spans(out), ["2026-08-03..2026-08-07"]);
  assertWellFormed(out, "bridge");
});

check("extending forward into an existing span also merges", () => {
  const out = cycleToggleDay([P("2026-08-03", "2026-08-04"), P("2026-08-06", "2026-08-08")], "2026-08-05");
  assert.strictEqual(cycleSortedPeriods(out).length, 1);
  assert.deepStrictEqual(spans(out), ["2026-08-03..2026-08-08"]);
});

check("a far-away tap stays its own span and does not swallow the gap", () => {
  const out = cycleToggleDay([P("2026-08-03", "2026-08-07")], "2026-09-01");
  assert.deepStrictEqual(spans(out), ["2026-08-03..2026-08-07", "2026-09-01..2026-09-01"]);
  assertWellFormed(out, "separate");
});

console.log("\ncycleToggleDay — removing a day");

check("tapping a one-day span deletes it, with no confirm to answer", () => {
  const out = cycleToggleDay([P("2026-08-03", "2026-08-03")], "2026-08-03");
  assert.deepStrictEqual(spans(out), []);
});

check("tapping the first day moves the start forward", () => {
  const out = cycleToggleDay([P("2026-08-03", "2026-08-07")], "2026-08-03");
  assert.deepStrictEqual(spans(out), ["2026-08-04..2026-08-07"]);
  assertWellFormed(out, "trim start");
});

check("tapping the last day moves the end back", () => {
  const out = cycleToggleDay([P("2026-08-03", "2026-08-07")], "2026-08-07");
  assert.deepStrictEqual(spans(out), ["2026-08-03..2026-08-06"]);
  assertWellFormed(out, "trim end");
});

check("tapping the middle splits the span in two", () => {
  const out = cycleToggleDay([P("2026-08-03", "2026-08-07")], "2026-08-05");
  assert.deepStrictEqual(spans(out), ["2026-08-03..2026-08-04", "2026-08-06..2026-08-07"]);
  assertWellFormed(out, "split");
});

check("a split mints a genuinely new id rather than cloning one", () => {
  const out = cycleToggleDay([P("2026-08-03", "2026-08-07")], "2026-08-05");
  const ids = cycleSortedPeriods(out).map((p) => p.id);
  assert.strictEqual(new Set(ids).size, 2, "two spans must not share an identity");
});

check("a split carries the recorded flow onto both halves", () => {
  const out = cycleToggleDay([P("2026-08-03", "2026-08-07", "heavy")], "2026-08-05");
  cycleSortedPeriods(out).forEach((p) => assert.strictEqual(p.flow, "heavy"));
});

console.log("\ncycleToggleDay — the invariants");

check("toggling the same day twice returns the original set of days", () => {
  const start = [P("2026-07-06", "2026-07-09"), P("2026-08-03", "2026-08-07")];
  ["2026-08-05", "2026-08-03", "2026-08-07", "2026-08-08", "2026-06-01"].forEach((iso) => {
    const there = cycleToggleDay(start, iso);
    const back = cycleToggleDay(there, iso);
    assert.deepStrictEqual(days(back), days(start), `round trip broke on ${iso}`);
  });
});

check("the input list is never mutated", () => {
  const start = [P("2026-08-03", "2026-08-07")];
  const snapshot = JSON.parse(JSON.stringify(start));
  cycleToggleDay(start, "2026-08-05");
  assert.deepStrictEqual(start, snapshot, "cycleToggleDay must be pure");
});

check("touching a legacy end:null record materialises its end", () => {
  // No migration runs anywhere. The first tap on an inherited open record is
  // what closes it -- and it closes at the inferred length, not at today, so
  // a period from three months ago cannot become a 90-day bleed.
  const list = [
    P("2026-06-06", "2026-06-09"),
    P("2026-07-06", "2026-07-09"),
    { id: "open", start: "2026-08-03", end: null, flow: null },
  ];
  const out = cycleToggleDay(list, "2026-08-07");
  const rec = cycleSortedPeriods(out).find((p) => p.start === "2026-08-03");
  assert.strictEqual(rec.end, "2026-08-07", "extending an open record should close it at the tapped day");
  assertWellFormed(out, "materialise");
});

check("every record the calendar writes carries an end", () => {
  // The whole point. There is no path through the new UI that leaves `end`
  // null, so the 5-day guess, the phantom chart band and the forever-"open"
  // row all stop being reachable.
  let list = [];
  ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-10", "2026-08-04"].forEach((iso) => {
    list = cycleToggleDay(list, iso);
  });
  assertWellFormed(list, "sequence");
  cycleSortedPeriods(list).forEach((p) => assert.ok(p.end, `open record left at ${p.start}`));
});

check("a 60-day bleed is not expressible by tapping", () => {
  // cycleLogEnd only checked `d >= p.start`, so tapping "It's ended" two
  // months late stamped a 60-day period. Tapping cannot reach that: a span
  // only grows one adjacent day at a time.
  const out = cycleToggleDay([P("2026-08-03", "2026-08-07")], "2026-10-02");
  const long = cycleSortedPeriods(out).find((p) => sandbox.cycleDaysBetween(p.start, p.end) > 20);
  assert.ok(!long, "a distant tap must start a new span, never stretch an old one");
});

check("cycle lengths still come out of a calendar-edited list", () => {
  // The derived series the predictions run on has to survive span editing --
  // it reads starts, and trimming the first day of a period MOVES a start.
  let list = [P("2026-06-06", "2026-06-10"), P("2026-07-06", "2026-07-11"), P("2026-08-03", "2026-08-07")];
  assert.deepStrictEqual(cycleLengths(list), [30, 28]);
  list = cycleToggleDay(list, "2026-08-03"); // "actually it started on the 4th"
  assert.deepStrictEqual(cycleLengths(list), [30, 29]);
});

console.log("\ncycleNudgeFor — the only place the app asks");

// Three 28-day cycles, so two lengths are measured (not "learning") and the
// next start predicts to 2026-08-16.
const REGULAR = [P("2026-05-24", "2026-05-28"), P("2026-06-21", "2026-06-25"), P("2026-07-19", "2026-07-23")];
const nudge = (list, today) => sandbox.cycleNudgeFor({ periods: list }, today);

check("the prediction the window is built around is the one being asked about", () => {
  assert.strictEqual(sandbox.cycleNextStart(REGULAR), "2026-08-16", "precondition: predicted next start");
  assert.strictEqual(sandbox.cycleLearning(REGULAR), false, "precondition: two measured cycles is not learning");
});

check("it asks on the day the period is predicted", () => {
  const n = nudge(REGULAR, "2026-08-16");
  assert.ok(n, "expected a nudge on the predicted day");
  assert.strictEqual(n.next, "2026-08-16");
});

check("it opens two days early and closes three days late", () => {
  // The window is the whole point: too narrow and it misses the day she
  // actually starts, too wide and it nags through the follicular phase.
  assert.ok(nudge(REGULAR, "2026-08-14"), "two days before should ask");
  assert.ok(nudge(REGULAR, "2026-08-19"), "three days after should still ask");
});

check("it is silent outside the window on both sides", () => {
  assert.strictEqual(nudge(REGULAR, "2026-08-13"), null, "three days before is too early");
  assert.strictEqual(nudge(REGULAR, "2026-08-20"), null, "four days after is too late");
  assert.strictEqual(nudge(REGULAR, "2026-07-30"), null, "mid-cycle is silent");
});

check("it never asks about a guess", () => {
  // One logged period measures no cycle length at all, so the prediction is
  // the 28-day default wearing a confident face. Asking on that date would
  // teach her the app is wrong about her body.
  const one = [P("2026-07-19", "2026-07-23")];
  assert.strictEqual(sandbox.cycleLearning(one), true, "precondition: one period is still learning");
  assert.strictEqual(nudge(one, "2026-08-16"), null);
  assert.strictEqual(nudge([], "2026-08-16"), null, "nothing logged at all asks nothing");
});

check("logging anything in the window answers the question and stops it", () => {
  // Not just "today is a bleed day" — ANY day in the window. She logged it on
  // the 15th, so asking her again on the 17th is the app not listening.
  const logged = [...REGULAR, P("2026-08-15", "2026-08-15")];
  assert.strictEqual(nudge(logged, "2026-08-17"), null, "already logged on the 15th");
  assert.strictEqual(nudge(logged, "2026-08-15"), null, "and on the day itself");
});

check("an early period re-anchors the cycle rather than just muting the ask", () => {
  // Worth pinning because the obvious reading is wrong. Logging a bleed day
  // before the predicted date does not "answer the question early" — there is
  // no spotting in this model, so that day IS a new cycle start. The average
  // re-measures (28, 28, 22 -> 26), the prediction moves to 5 Sep, and the ask
  // travels with it. Silence on the 16th is the window having MOVED, not the
  // nudge having been suppressed, and a future refactor that muted it instead
  // would look identical here without this check.
  const early = [...REGULAR, P("2026-08-10", "2026-08-14")];
  assert.strictEqual(sandbox.cycleNextStart(early), "2026-09-05",
    "an early start re-measures the average and moves the prediction");
  assert.strictEqual(nudge(early, "2026-08-16"), null, "silent because the window moved, not because it was muted");
  const n = nudge(early, "2026-09-05");
  assert.ok(n, "and it asks again on the new date");
  assert.strictEqual(n.next, "2026-09-05");
});

check("dismissing it silences that cycle and only that cycle", () => {
  sandbox.setNudgeSeen("2026-08-16");
  assert.strictEqual(nudge(REGULAR, "2026-08-16"), null, "dismissed for this prediction");
  sandbox.setNudgeSeen("2026-07-19");           // last cycle's dismissal
  assert.ok(nudge(REGULAR, "2026-08-16"), "a stale dismissal must not silence the next one");
  sandbox.setNudgeSeen("");
});

check("the window tracks the prediction, not the calendar", () => {
  // A 35-day cycle moves the whole window with it. Hard-coding around day 28
  // would ask everyone with a long cycle a week early, every month.
  const long = [P("2026-05-08", "2026-05-12"), P("2026-06-12", "2026-06-16"), P("2026-07-17", "2026-07-21")];
  assert.strictEqual(sandbox.cycleNextStart(long), "2026-08-21", "precondition: 35-day cycles predict later");
  assert.strictEqual(nudge(long, "2026-08-16"), null, "silent on the 28-day date");
  assert.ok(nudge(long, "2026-08-21"), "asks on its own date");
});

console.log(failures ? `\n${failures} failing\n` : "\nall passing\n");
process.exit(failures ? 1 : 0);
