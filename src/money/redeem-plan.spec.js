// The sweep's charge plan — the guards that decide what a run may spend.
// Frozen from the shipped autoRedeemFinishedBookings on extraction; the
// within-run dedupe (planned counts as existing) is the one behavior that
// previously lived implicitly in mid-loop mutation.
import { describe, it, expect } from "vitest";
import "./redeem-plan.js";

const { redeemSweepPlan } = globalThis.STSD.money;

const HOUR = 3600000;
const T0 = Date.parse("2026-08-10T18:00:00Z");
const ev = (uid, startMs, over = {}) => ({
  uid, startAt: new Date(startMs).toISOString(),
  endAt: new Date(startMs + HOUR).toISOString(), ...over,
});
const mkOpts = (banks = {}, over = {}) => ({
  since: T0 - 30 * 24 * HOUR,
  now: T0 + 2 * HOUR,
  resolve: (e) => (e.who ? { id: e.who } : null),
  bankOf: (id) => banks[id] || { redemptions: [], missedSessions: [] },
  slotsMatch: (a, b) => a != null && b != null && Math.abs(a - b) <= 1,
  dateOf: (e) => new Date(e.startAt).toISOString().slice(0, 10),
  noteOf: () => "Booked session · 11:00 AM",
  ...over,
});

describe("redeemSweepPlan", () => {
  it("charges a finished, matched, unguarded session and skips unmatched or unfinished ones", () => {
    const plan = redeemSweepPlan([
      ev("stsd:a", T0, { who: "leo" }),          // finished, matched
      ev("stsd:b", T0 + 3 * HOUR, { who: "leo" }), // ends after `now`
      ev("stsd:c", T0, {}),                        // unmatched
      ev(null, T0, { who: "leo" }),                // no uid
    ], mkOpts());
    expect(plan).toEqual([
      { athleteId: "leo", uid: "stsd:a", date: "2026-08-10", slot: Math.floor(T0 / 60000), note: "Booked session · 11:00 AM" },
    ]);
  });

  it("the watermark is exclusive at the start: a session that ended exactly at `since` never charges", () => {
    const opts = mkOpts({}, { since: T0 + HOUR });
    expect(redeemSweepPlan([ev("stsd:a", T0, { who: "leo" })], opts)).toEqual([]);
  });

  it("an existing redemption blocks by uid, by manual-on-date, by slot, and by date+note", () => {
    const base = ev("stsd:a", T0, { who: "leo" });
    const cases = [
      { redemptions: [{ setmoreUid: "stsd:a" }], missedSessions: [] },
      { redemptions: [{ setmoreUid: null, date: "2026-08-10" }], missedSessions: [] },
      { redemptions: [{ setmoreUid: "stsd:other", slot: Math.floor(T0 / 60000) }], missedSessions: [] },
      { redemptions: [{ setmoreUid: "stsd:other", date: "2026-08-10", note: "Booked session · 11:00 AM" }], missedSessions: [] },
    ];
    cases.forEach((bank) => {
      expect(redeemSweepPlan([base], mkOpts({ leo: bank }))).toEqual([]);
    });
  });

  it("a close-called session is waived, never charged", () => {
    const bank = { redemptions: [], missedSessions: [{ setmoreUid: "stsd:a", type: "closecall" }] };
    expect(redeemSweepPlan([ev("stsd:a", T0, { who: "leo" })], mkOpts({ leo: bank }))).toEqual([]);
  });

  it("a mirror and a native booking for the same slot collapse to ONE charge within a run", () => {
    const plan = redeemSweepPlan([
      ev("9e1d-mirror-uid", T0, { who: "leo" }),
      ev("stsd:native", T0, { who: "leo" }),
    ], mkOpts());
    expect(plan.length).toBe(1);
    expect(plan[0].uid).toBe("9e1d-mirror-uid"); // event order: first name wins
  });

  it("different athletes at the same slot each get their own charge", () => {
    const plan = redeemSweepPlan([
      ev("stsd:a", T0, { who: "leo" }),
      ev("stsd:b", T0, { who: "mara" }),
    ], mkOpts());
    expect(plan.map((p) => p.athleteId).sort()).toEqual(["leo", "mara"]);
  });

  it("a catch-up backlog produces every uncharged finished session, in order", () => {
    const plan = redeemSweepPlan([
      ev("stsd:w1", T0 - 14 * 24 * HOUR, { who: "leo" }),
      ev("stsd:w2", T0 - 7 * 24 * HOUR, { who: "leo" }),
      ev("stsd:w3", T0, { who: "leo" }),
    ], mkOpts());
    expect(plan.map((p) => p.uid)).toEqual(["stsd:w1", "stsd:w2", "stsd:w3"]);
  });
});
