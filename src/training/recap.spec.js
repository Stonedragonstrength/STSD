// The Program Recap derivation — the week-by-day completion model behind the
// roster drawer's matrix, the day popup, and the recap sheet (2026-08-18).
//
// What earns the paranoia: "done" here must mean exactly what the roster's
// 5/18 already means (dayCompletions only), and "typed but never ✓-locked"
// must surface as its own thing — a filled-looking day reading 4/6 with no
// explanation is a bug Nathan has already reported once (Tim, Week 3 Day 1).
import { describe, it, expect, beforeEach } from "vitest";
import "./recap.js";

const { recapModel, recapExerciseDisplay, recapExtraSessions } =
  globalThis.STSD.training;

// The module reads the app's lock semantics through the seam at call time,
// so the shipped checker (legacy fallbacks included) stays the one authority.
// The spec's stand-in is deliberately minimal: locked === true and nothing else.
beforeEach(() => {
  globalThis.STSD.app = Object.assign(globalThis.STSD.app || {}, {
    isLogEntryLocked: (l) => l?.locked === true,
  });
});

const ex = (id) => ({ id, name: id, sets: "3" });
const day = (id, exIds = ["a-" + id, "b-" + id]) => ({ id, name: "Day " + id, exercises: exIds.map(ex) });
const wk = (id, days) => ({ id, label: "Week " + id, days });
const P = (over = {}) => ({ exerciseLogs: {}, dayCompletions: {}, ...over });

const twoWeeks = () => [
  wk("w1", [day("d1"), day("d2"), day("d3")]),
  wk("w2", [day("d4"), day("d5"), day("d6")]),
];

describe("recapModel day states", () => {
  it("a day with a completion is done, dated by its latest completion", () => {
    const p = P({ dayCompletions: { d1: ["2026-07-07", "2026-07-14"] } });
    const m = recapModel(twoWeeks(), p, "d2");
    const d1 = m.weeks[0].days[0];
    expect(d1.state).toBe("done");
    expect(d1.date).toBe("2026-07-14");
  });

  it("done comes from dayCompletions ONLY — locked logs without a completion are partial, so the count matches the roster's", () => {
    const p = P({
      exerciseLogs: { "a-d1": [{ date: "2026-07-07", locked: true, sets: [{ weight: 100, reps: 8 }] }] },
    });
    const m = recapModel(twoWeeks(), p, "d1");
    expect(m.weeks[0].days[0].state).toBe("partial");
    expect(m.doneDays).toBe(0);
  });

  it("counts locked, typed and skipped exercises separately, one bucket per exercise", () => {
    const p = P({
      exerciseLogs: {
        "a-d1": [
          { date: "2026-07-03", sets: [{ weight: 90, reps: 8 }] }, // old draft
          { date: "2026-07-10", locked: true, sets: [{ weight: 95, reps: 8 }] },
        ],
        "b-d1": [{ date: "2026-07-10", sets: [{ weight: 40, reps: 15 }] }], // typed, never locked
      },
    });
    const m = recapModel(twoWeeks(), p, "d2");
    const d1 = m.weeks[0].days[0];
    expect(d1.state).toBe("partial");
    expect(d1.locked).toBe(1); // a-d1 counts once, as locked, despite the draft
    expect(d1.typed).toBe(1);
    expect(d1.skipped).toBe(0);
    expect(d1.total).toBe(2);
    expect(d1.date).toBe("2026-07-10");
  });

  it("a day whose only work is skips reads skipped, not partial", () => {
    const p = P({
      exerciseLogs: {
        "a-d1": [{ date: "2026-07-09", skipped: true }],
        "b-d1": [{ date: "2026-07-09", skipped: true }],
      },
    });
    const m = recapModel(twoWeeks(), p, "d2");
    expect(m.weeks[0].days[0].state).toBe("skipped");
    expect(m.weeks[0].days[0].skipped).toBe(2);
  });

  it("rounds-only entries (mobility holds) count as typed work", () => {
    const p = P({ exerciseLogs: { "a-d1": [{ date: "2026-07-09", rounds: [true, false] }] } });
    const m = recapModel(twoWeeks(), p, "d2");
    expect(m.weeks[0].days[0].state).toBe("partial");
    expect(m.weeks[0].days[0].typed).toBe(1);
  });

  it("the current day is next; workless days before it are missed, after it upcoming", () => {
    const p = P({ dayCompletions: { d1: ["2026-07-07"], d3: ["2026-07-11"] } });
    const m = recapModel(twoWeeks(), p, "d4");
    const states = m.weeks.flatMap((w) => w.days.map((d) => d.state));
    expect(states).toEqual(["done", "missed", "done", "next", "upcoming", "upcoming"]);
  });

  it("with no current day nothing reads missed", () => {
    const m = recapModel(twoWeeks(), P(), null);
    expect(m.weeks.flatMap((w) => w.days.map((d) => d.state)))
      .toEqual(Array(6).fill("upcoming"));
  });
});

describe("recapModel totals", () => {
  it("doneDays/totalDays are the roster's math, and week subtotals agree", () => {
    const p = P({ dayCompletions: { d1: ["2026-07-07"], d2: ["2026-07-09"], d4: ["2026-07-14"] } });
    const m = recapModel(twoWeeks(), p, "d5");
    expect(m.totalDays).toBe(6);
    expect(m.doneDays).toBe(3);
    expect(m.weeks[0].done).toBe(2);
    expect(m.weeks[1].done).toBe(1);
    expect(m.weeks[0].total).toBe(3);
  });

  it("lastTrained is the max over completions and LOCKED logs — a newer draft does not move it", () => {
    const p = P({
      dayCompletions: { d1: ["2026-07-07"] },
      exerciseLogs: {
        "a-d2": [{ date: "2026-07-09", locked: true, sets: [{ weight: 60, reps: 10 }] }],
        "b-d2": [{ date: "2026-07-16", sets: [{ weight: 60, reps: 10 }] }], // draft, newest
      },
    });
    const m = recapModel(twoWeeks(), p, "d3");
    expect(m.lastTrained).toBe("2026-07-09");
  });

  it("maxSlots spans uneven weeks and short weeks pad with nothing", () => {
    const m = recapModel([wk("w1", [day("d1")]), wk("w2", [day("d4"), day("d5")])], P(), null);
    expect(m.maxSlots).toBe(2);
    expect(m.weeks[0].days.length).toBe(1);
  });

  it("weeks carry their labels through", () => {
    const weeks = twoWeeks();
    weeks[0].phaseLabel = "Base";
    const m = recapModel(weeks, P(), null);
    expect(m.weeks[0].label).toBe("Week w1");
    expect(m.weeks[0].phaseLabel).toBe("Base");
  });

  it("an empty progress object and a null one read the same", () => {
    expect(recapModel(twoWeeks(), null, null).doneDays).toBe(0);
    expect(recapModel(twoWeeks(), null, null).lastTrained).toBe(null);
  });
});

describe("recapExerciseDisplay", () => {
  it("shows the newest entry that carries data, flagged with ITS state — a newer draft outranks an older locked entry and reads typed", () => {
    const p = P({
      exerciseLogs: {
        a: [
          { date: "2026-08-03", locked: true, sets: [{ weight: 95, reps: 8 }, { weight: 95, reps: 7 }] },
          { date: "2026-08-10", sets: [{ weight: 100, reps: 8 }] },
        ],
      },
    });
    const d = recapExerciseDisplay(ex("a"), p);
    expect(d.kind).toBe("typed");
    expect(d.date).toBe("2026-08-10");
    expect(d.sets).toEqual([{ weight: 100, reps: 8 }]);
  });

  it("flat legacy entries (weight/reps on the entry) become one set", () => {
    const p = P({ exerciseLogs: { a: [{ date: "2026-07-01", locked: true, weight: 80, reps: 12 }] } });
    expect(recapExerciseDisplay(ex("a"), p)).toMatchObject({
      kind: "locked", sets: [{ weight: 80, reps: 12 }],
    });
  });

  it("rounds entries report done/total instead of sets", () => {
    const p = P({ exerciseLogs: { a: [{ date: "2026-07-01", locked: true, rounds: [true, true, false] }] } });
    expect(recapExerciseDisplay(ex("a"), p)).toMatchObject({
      kind: "locked", sets: null, rounds: { done: 2, total: 3 },
    });
  });

  it("a skip is reported as skipped; no entries at all is none", () => {
    const p = P({ exerciseLogs: { a: [{ date: "2026-07-01", skipped: true }] } });
    expect(recapExerciseDisplay(ex("a"), p).kind).toBe("skipped");
    expect(recapExerciseDisplay(ex("b"), p).kind).toBe("none");
  });
});

describe("recapExtraSessions", () => {
  it("counts extra days the way the one-off cards do: any exercise with an entry not explicitly unlocked, or a completion", () => {
    const p = P({
      dayCompletions: { o3: ["2026-07-20"] },
      exerciseLogs: {
        "a-o1": [{ date: "2026-07-05", weight: 50, reps: 10 }], // legacy, no flag → counts
        "a-o2": [{ date: "2026-07-06", locked: false, sets: [{ weight: 50, reps: 10 }] }], // draft → not a session
      },
    });
    const days = [day("o1", ["a-o1"]), day("o2", ["a-o2"]), day("o3", ["a-o3"]), day("o4", ["a-o4"])];
    expect(recapExtraSessions(days, p)).toBe(2); // o1 (legacy entry) + o3 (completion)
    expect(recapExtraSessions([], p)).toBe(0);
    expect(recapExtraSessions(days, null)).toBe(0);
  });
});
