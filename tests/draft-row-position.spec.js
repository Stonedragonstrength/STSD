// @vitest-environment jsdom
//
// A draft remembers WHICH ROW each set came from.
//
// The bug this guards (2026-08-20): the filler's 800ms draft save mapped every
// set row and then `.filter`ed out the empty ones, so a card with only set 2
// filled stored one set — and the restore, `todayLog.sets.forEach((s, i) =>
// setInputs[i]...)`, put it back in set 1. Every re-render of the day walked
// the numbers up the card, and a row the athlete had filled came back blank.
// That is what "it cleared my work" and "the numbers jumped back" were.
//
// A LOCKED entry never had the problem: lockIn stores every row, gaps and all.
// Only the draft compacts, so only the draft needs the row number.
//
// Extracts the real commitDraft out of app.js rather than re-coding it
// (tests/README.md: a copy goes green while the shipped app stays broken).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFns } from "./helpers/load-fn.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function mkRow(weight = "", reps = "", skipped = false) {
  const wt = document.createElement("input");
  const rp = document.createElement("input");
  wt.value = weight;
  rp.value = reps;
  return { wt, rp, skipped };
}

function build(setInputs, { noteIds = [] } = {}) {
  const progress = { exerciseLogs: {} };
  const state = { clientData: { progress } };
  const { commitDraft } = loadFns("const commitDraft =", {
    _ast: null,
    setInputs,
    noteIds,
    outW: (v) => v,                       // display unit === storage unit here
    finisherHasData: () => false,
    warmupHasData: () => false,
    collectWarmups: () => ({}),
    collectFinishers: () => ({}),
    collectRir: () => ({}),
    collectNotes: () => (noteIds.length ? { notes: [...noteIds] } : {}),
    ex: { id: "e1" },
    logDate: "2026-08-20",
    uid: () => "draft1",
    state,
    saveClient: vi.fn(),
    renderAthleteCalendar: vi.fn(),
  });
  return { commitDraft, progress };
}

const stored = (progress) => progress.exerciseLogs.e1?.[0]?.sets;

describe("the filler's draft keeps its row numbers", () => {
  it("files a lone middle set under the row it was typed in", () => {
    const { commitDraft, progress } = build([mkRow(), mkRow("185", "5"), mkRow()]);
    commitDraft();
    expect(stored(progress)).toEqual([{ weight: "185", reps: "5", i: 1 }]);
  });

  it("keeps the gap between two filled rows", () => {
    const { commitDraft, progress } = build([mkRow("135", "8"), mkRow(), mkRow("155", "6")]);
    commitDraft();
    expect(stored(progress).map((s) => s.i)).toEqual([0, 2]);
  });

  it("still numbers a skipped row, which is a real answer", () => {
    const { commitDraft, progress } = build([mkRow(), mkRow("", "", true), mkRow("225", "3")]);
    commitDraft();
    expect(stored(progress)).toEqual([
      { weight: "", reps: "", skipped: true, i: 1 },
      { weight: "225", reps: "3", i: 2 },
    ]);
  });

  it("drops the entry entirely when nothing is filled in", () => {
    const { commitDraft, progress } = build([mkRow(), mkRow(), mkRow()]);
    progress.exerciseLogs.e1 = [{ date: "2026-08-20", sets: [{ weight: "1", reps: "1" }] }];
    commitDraft();
    expect(progress.exerciseLogs.e1).toEqual([]);
  });

  it("and the card reads the row number back", () => {
    // The restore lives inline in renderClientExercise, so there is no
    // declaration to extract — this is the tripwire for the other half.
    const src = readFileSync(join(ROOT, "app.js"), "utf8");
    expect(src).toMatch(/setInputs\[Number\.isInteger\(s\.i\) \? s\.i : i\]/);
  });
});
