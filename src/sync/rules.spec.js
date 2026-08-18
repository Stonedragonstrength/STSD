// The sync decision rules, and the proof that the app actually uses them.
// Written when rules.js was created (tier 1: a real import of the shipped
// file) — the payoff brick of Phase 1.
//
// Two layers, deliberately:
//   1. BEHAVIOUR — the named rules do what their comments claim, including
//      the owner-ruled sign-in change (2026-08-17): a pulled progress row
//      merges exercise logs with the cached copy only when that cache is
//      the same account's data, and adopts wholesale otherwise.
//   2. WIRING — source pins on app.js, because a rule module nobody calls
//      is this codebase's house failure: the four realtime guard chains,
//      resyncNow, both boot paths and sign-in must actually route through
//      these names, with no raw rev-comparison left behind to drift.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./merge-logs.js";
import "./progress-shape.js";
import "./rules.js";

const { mayAdoptRow, adoptedAthleteProgress } = globalThis.STSD.sync;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const appSrc = readFileSync(join(ROOT, "app.js"), "utf8");

/** Brace-match a function body out of app.js. */
function fnBody(decl) {
  const at = appSrc.indexOf(decl);
  if (at < 0) throw new Error(`not found in app.js: ${decl}`);
  const open = appSrc.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < appSrc.length; i++) {
    if (appSrc[i] === "{") depth++;
    else if (appSrc[i] === "}") { depth--; if (!depth) return appSrc.slice(open, i + 1); }
  }
  throw new Error(`unbalanced: ${decl}`);
}
const count = (src, re) => (src.match(re) || []).length;

const entry = (id, m, w) => ({ id, date: "2026-08-16", m, sets: [{ weight: w, reps: 5 }] });

describe("mayAdoptRow", () => {
  it("adopts only genuine news: a newer rev on a clean surface", () => {
    expect(mayAdoptRow({ incomingRev: 5, knownRev: 4, locallyDirty: 0 })).toBe(true);
  });

  it("an equal rev is our own echo, and an older one is stale — both no-ops", () => {
    expect(mayAdoptRow({ incomingRev: 4, knownRev: 4, locallyDirty: 0 })).toBe(false);
    expect(mayAdoptRow({ incomingRev: 3, knownRev: 4, locallyDirty: 0 })).toBe(false);
  });

  it("the dirty window vetoes even genuine news — unconfirmed local edits own the surface", () => {
    expect(mayAdoptRow({ incomingRev: 5, knownRev: 4, locallyDirty: Date.parse("2026-08-16") })).toBe(false);
    expect(mayAdoptRow({ incomingRev: 5, knownRev: 4, locallyDirty: true })).toBe(false);
  });

  it("a row with no rev is never news, and an unknown local rev counts as 0", () => {
    expect(mayAdoptRow({ incomingRev: undefined, knownRev: undefined, locallyDirty: 0 })).toBe(false);
    expect(mayAdoptRow({ incomingRev: 1, knownRev: undefined, locallyDirty: 0 })).toBe(true);
  });

  it("coerces revs that arrive as strings — numerically, not lexicographically", () => {
    expect(mayAdoptRow({ incomingRev: "5", knownRev: 4, locallyDirty: 0 })).toBe(true);
    expect(mayAdoptRow({ incomingRev: "4", knownRev: "4", locallyDirty: 0 })).toBe(false);
    // The case a raw comparison gets wrong: "10" < "9" as strings.
    expect(mayAdoptRow({ incomingRev: "10", knownRev: "9", locallyDirty: 0 })).toBe(true);
  });
});

describe("adoptedAthleteProgress", () => {
  const local = () => ({
    exerciseLogs: { exbench: [entry("a", 200, 225)] },
    dayNotes: { d1: "typed locally, never pushed" },
    feedback: "local words",
  });
  const cloud = () => ({
    exerciseLogs: { exbench: [entry("b", 100, 220)] },
    dayNotes: { d1: "the cloud's note" },
    feedback: "cloud words",
    syncedAt: "2026-08-16T20:00:00.000Z",
    _rev: 7,
  });

  it("unions exercise logs — a pull can never erase work the cloud has not seen", () => {
    const out = adoptedAthleteProgress(local(), cloud());
    const ids = out.exerciseLogs.exbench.map((e) => e.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("passes the sides to the merge in the right order: a same-id stamp tie goes to LOCAL", () => {
    // mergeExerciseLogs breaks ties toward its first argument — the device
    // in hand is the one being edited. Swapping the arguments would flip
    // every tie toward the cloud, silently.
    const l = { exerciseLogs: { exbench: [entry("x", 100, 225)] } };
    const c = { ...cloud(), exerciseLogs: { exbench: [entry("x", 100, 220)] } };
    const kept = adoptedAthleteProgress(l, c).exerciseLogs.exbench.find((e) => e.id === "x");
    expect(kept.sets[0].weight).toBe(225);
  });

  it("every other field is the cloud's, wholesale — preferences and containers, not the loss family", () => {
    const out = adoptedAthleteProgress(local(), cloud());
    expect(out.feedback).toBe("cloud words");
    expect(out.dayNotes).toEqual({ d1: "the cloud's note" });
    expect(out._rev).toBe(7);
  });

  it("mergeLogs false (a different account's cache): wholesale, no leak of the other athlete's logs", () => {
    const out = adoptedAthleteProgress(local(), cloud(), { mergeLogs: false });
    expect(out.exerciseLogs.exbench.map((e) => e.id)).toEqual(["b"]);
    expect(out.feedback).toBe("cloud words");
  });

  it("shape-repairs the result, so a sparse cloud row cannot crash a render", () => {
    const out = adoptedAthleteProgress(null, { exerciseLogs: {}, _rev: 1 });
    expect(out.cardioLogs).toEqual([]);
    expect(out.dayCompletions).toEqual({});
    expect(out.avatarId).toBe("");
  });

  it("keeps the row's own syncedAt rather than stamping a new one", () => {
    expect(adoptedAthleteProgress(local(), cloud()).syncedAt).toBe("2026-08-16T20:00:00.000Z");
  });

  it("never mutates the cloud input — resyncNow used to, and a shared reference is a bug lying in wait", () => {
    const c = cloud();
    adoptedAthleteProgress(local(), c);
    expect(c.exerciseLogs.exbench.map((e) => e.id)).toEqual(["b"]);
    expect(c.cardioLogs).toBeUndefined();
    // The wholesale branch must copy too — shape repair on a shared
    // reference would write into the caller's row object.
    const w = cloud();
    adoptedAthleteProgress(local(), w, { mergeLogs: false });
    expect(w.cardioLogs).toBeUndefined();
  });

  it("no cloud row: keeps local, identity-returned so callers can tell 'unchanged'", () => {
    const l = local();
    expect(adoptedAthleteProgress(l, null)).toBe(l);
    expect(adoptedAthleteProgress(l, undefined)).toBe(l);
  });

  it("nothing at all is null, never a fabricated empty progress", () => {
    expect(adoptedAthleteProgress(null, null)).toBe(null);
    expect(adoptedAthleteProgress(undefined, undefined)).toBe(null);
  });
});

describe("the app is wired through the rules", () => {
  it("both realtime handlers gate every apply with mayAdoptRow, with no raw rev comparison left", () => {
    const athleteRow = fnBody("function handleRealtimeAthleteRow(");
    const progressRow = fnBody("function handleRealtimeProgressRow(");
    expect(count(athleteRow, /\bmayAdoptRow\(/g)).toBe(2);
    expect(count(progressRow, /\bmayAdoptRow\(/g)).toBe(2);
    // The drift this closes: four hand-copied `(rev || 0) <= (Number(...) || 0)`
    // chains. None may remain to disagree with the named rule.
    expect(count(athleteRow + progressRow, /_rev\s*\|\|\s*0\)\s*<=/g)).toBe(0);
  });

  it("the realtime progress apply uses the same appliers as the pull paths", () => {
    const progressRow = fnBody("function handleRealtimeProgressRow(");
    expect(count(progressRow, /\bmergedRosterProgress\(/g)).toBe(1);
    expect(count(progressRow, /\badoptedAthleteProgress\(/g)).toBe(1);
  });

  it("resyncNow and both boot paths adopt through adoptedAthleteProgress", () => {
    expect(count(fnBody("async function resyncNow("), /\badoptedAthleteProgress\(/g)).toBe(1);
    expect(count(fnBody("async function init("), /\badoptedAthleteProgress\(/g)).toBe(2);
  });

  it("sign-in merges under the same-account rule (owner ruling 2026-08-17)", () => {
    const signIn = fnBody("async function signInAthlete(");
    expect(count(signIn, /\badoptedAthleteProgress\(/g)).toBe(1);
    expect(signIn).toContain("mergeLogs: sameAccount");
    // The guard itself: the cached profile's email decides whose data the
    // cache is. Without this line the merge would pollute across athletes
    // on a shared device.
    expect(/sameAccount\s*=\s*!!state\.clientData\.profile\?\.email/.test(signIn)).toBe(true);
  });
});
