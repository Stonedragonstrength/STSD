// The merge rules — the module the design doc GATED on an owner ruling.
// Ruled 2026-08-18: frozen as shipped. These tests are the freeze.
//
// The rules the August incidents settled:
//   • slotsMatch: a slot is a minute bucket, and same-or-adjacent bucket is
//     the same session. Bucket EQUALITY split 08:59:59 from 09:00:01 — one
//     session two seconds apart — and produced the Setmore double charges.
//   • mirrorEventsToKeep: past the cutoff the mirror is dead; and a native
//     booking — CANCELLED ONES INCLUDED — kills the mirror for its slot
//     whatever the cutoff says. The cutoff alone wasn't enough (19 double
//     charges across 14 athletes: stale devices fall back to Infinity), and
//     excluding cancelled bookings handed a cancelled slot back to the mirror,
//     which then charged for a session the coach had just cancelled (4 Aug).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./merge.js";

const { slotsMatch, mirrorEventsToKeep } = globalThis.STSD.scheduling;

const bucket = (iso) => Math.floor(new Date(iso).getTime() / 60000);

// Ported verbatim from tests/slots-match.spec.js at the extraction.
describe("slotsMatch", () => {
  it("same bucket matches", () => {
    expect(slotsMatch(100, 100)).toBe(true);
  });

  it("a second's drift across a minute boundary still matches", () => {
    expect(slotsMatch(bucket("2026-08-17T08:59:59Z"), bucket("2026-08-17T09:00:01Z"))).toBe(true);
  });

  it("two buckets apart is a different session", () => {
    expect(slotsMatch(100, 102)).toBe(false);
    expect(slotsMatch(bucket("2026-08-17T09:00:00Z"), bucket("2026-08-17T09:15:00Z"))).toBe(false);
  });

  it("a missing slot never matches anything", () => {
    expect(slotsMatch(null, 100)).toBe(false);
    expect(slotsMatch(100, undefined)).toBe(false);
    expect(slotsMatch(null, null)).toBe(false);
  });
});

describe("mirrorEventsToKeep", () => {
  const CUTOFF = Date.parse("2026-08-03T02:14:35.529Z"); // production's actual cutoff shape
  const ev = (uid, startAt) => ({ uid, startAt });
  const booked = (athlete_id, start_at, status = "booked") => ({ athlete_id, start_at, status });
  const matchTo = (map) => (e) => (map[e.uid] ? { id: map[e.uid] } : null);

  it("past the cutoff the mirror is dead — at the instant itself included", () => {
    const events = [
      ev("before", "2026-08-03T02:14:35.528Z"),
      ev("at", "2026-08-03T02:14:35.529Z"),
      ev("after", "2026-08-10T13:00:00Z"),
    ];
    const kept = mirrorEventsToKeep(events, [], CUTOFF, () => null);
    expect(kept.map((e) => e.uid)).toEqual(["before"]);
  });

  it("a native booking kills the mirror for its slot, whatever the cutoff says", () => {
    // The stale-device case: no cutoff pulled yet → Infinity keeps every
    // mirrored event — and native-wins is the guard that still holds.
    const events = [ev("dupe", "2026-08-20T13:00:00Z"), ev("other", "2026-08-20T15:00:00Z")];
    const native = [booked("a", "2026-08-20T13:00:00Z")];
    const kept = mirrorEventsToKeep(events, native, Infinity, matchTo({ dupe: "a", other: "a" }));
    expect(kept.map((e) => e.uid)).toEqual(["other"]);
  });

  it("a second's drift across a minute boundary is still the same slot", () => {
    const events = [ev("drift", "2026-08-20T13:00:01Z")];
    const native = [booked("a", "2026-08-20T12:59:59Z")];
    expect(mirrorEventsToKeep(events, native, Infinity, matchTo({ drift: "a" }))).toEqual([]);
  });

  it("fifteen minutes apart is a different session and survives", () => {
    const events = [ev("next", "2026-08-01T13:15:00Z")];
    const native = [booked("a", "2026-08-01T13:00:00Z")];
    expect(mirrorEventsToKeep(events, native, CUTOFF, matchTo({ next: "a" }))
      .map((e) => e.uid)).toEqual(["next"]);
  });

  it("a CANCELLED native booking still owns its slot (4 August)", () => {
    // Otherwise cancelling a booking hands the slot back to the mirror, which
    // then charges for the session the coach just cancelled.
    const events = [ev("dupe", "2026-08-01T13:00:00Z")];
    const native = [booked("a", "2026-08-01T13:00:00Z", "cancelled")];
    expect(mirrorEventsToKeep(events, native, CUTOFF, matchTo({ dupe: "a" }))).toEqual([]);
  });

  it("another athlete's booking does not take this one's slot", () => {
    const events = [ev("mine", "2026-08-01T13:00:00Z")];
    const native = [booked("b", "2026-08-01T13:00:00Z")];
    expect(mirrorEventsToKeep(events, native, CUTOFF, matchTo({ mine: "a" }))
      .map((e) => e.uid)).toEqual(["mine"]);
  });

  it("an event matched to nobody is kept — dropping it would hide a real session", () => {
    const events = [ev("unmatched", "2026-08-01T13:00:00Z")];
    const native = [booked("a", "2026-08-01T13:00:00Z")];
    expect(mirrorEventsToKeep(events, native, CUTOFF, () => null)
      .map((e) => e.uid)).toEqual(["unmatched"]);
  });

  it("empty inputs are empty outputs, not a throw", () => {
    expect(mirrorEventsToKeep(undefined, undefined, CUTOFF, () => null)).toEqual([]);
  });
});

// ---- WIRING (the rules.js pattern): the module only guards the calendar if
// app.js actually routes through it. These pins fail if the call site drifts.
describe("wiring: app.js routes through the module", () => {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

  it("the dashboard union calls mirrorEventsToKeep with the cutoff and the matcher", () => {
    expect(appSrc).toContain(
      "const mirrored = mirrorEventsToKeep(events, native, setmoreCutoffMs(), matchAthleteForEvent);");
  });

  it("no inline mirror filter survives beside it", () => {
    // The lifted body must not also remain in app.js, or the module tests a
    // copy while the calendar runs the original.
    expect(appSrc).not.toContain("const nativeSlots = new Set(");
  });

  it("auto-redeem still charges once per SLOT through slotsMatch", () => {
    // The guard moved into src/money/redeem-plan.js (2026-08-19, the
    // catch-up-asks-first extraction); the sweep in app.js must route
    // through the plan and hand it THIS slot identity, and the plan must
    // still hold the guard. Its behavior is specced in redeem-plan.spec.js.
    expect(appSrc).toContain("redeemSweepPlan(_dashCalSetmoreEvents");
    expect(appSrc).toMatch(/redeemSweepPlan\(_dashCalSetmoreEvents[\s\S]{0,400}slotsMatch/);
    const planSrc = fs.readFileSync(path.join(ROOT, "src/money/redeem-plan.js"), "utf8");
    expect(planSrc).toContain("if (reds.some((r) => slotsMatch(r.slot, slot))) return;");
  });

  it("late-cancel still refuses a second token for the same slot", () => {
    expect(appSrc).toContain("if (!reds.some((r) => r.setmoreUid === key || slotsMatch(r.slot, slot)))");
  });
});
