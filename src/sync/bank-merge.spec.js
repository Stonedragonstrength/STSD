// The session-bank merge behind upsertAthlete's rebase (2026-08-19).
//
// What earns the paranoia: Leo Frostholm's bank arrived at the cloud EMPTY —
// packages Nathan had seen "multiple times" and three weeks of session
// charges, gone — because a whole-row push from a device holding a stale
// copy overwrites whatever landed since. This merge is the seal: when a push
// loses the rev race, the retry must carry the union of both banks, so money
// that ever landed can no longer be silently erased by a slower device.
//
// The one deliberate asymmetry: deletions can resurrect. A package removed
// on one device while another still holds it comes back on the next race —
// VISIBLE (the balance jumps up), and trivially re-deleted. The failure mode
// this module kills is the invisible one. Tombstones can come later if
// resurrection ever actually bites.
import { describe, it, expect } from "vitest";
import "./bank-merge.js";

const { mergeSessionBank } = globalThis.STSD.sync;

const red = (id, uid, date, extra = {}) => ({ id, setmoreUid: uid, date, slot: extra.slot ?? null, note: extra.note || "", ...extra });

describe("mergeSessionBank redemptions", () => {
  it("unions by setmoreUid: head's entries survive, local-only entries join", () => {
    const head = { redemptions: [red("h1", "stsd:a", "2026-08-06")] };
    const local = { redemptions: [red("l1", "stsd:b", "2026-08-10")] };
    const m = mergeSessionBank(local, head, {});
    expect(m.redemptions.map((r) => r.setmoreUid).sort()).toEqual(["stsd:a", "stsd:b"]);
  });

  it("the same session charged on two devices under different ids collapses to one", () => {
    const head = { redemptions: [red("h1", "stsd:a", "2026-08-06")] };
    const local = { redemptions: [red("l9", "stsd:a", "2026-08-06")] };
    const m = mergeSessionBank(local, head, {});
    expect(m.redemptions.length).toBe(1);
    expect(m.redemptions[0].id).toBe("h1"); // head's copy is the one already on the books
  });

  it("manual redemptions with no uid fall back to slot, then id", () => {
    const head = { redemptions: [red("h1", null, "2026-08-06", { slot: 100 })] };
    const local = { redemptions: [red("l1", null, "2026-08-06", { slot: 100 }), red("l2", null, "2026-08-07", { slot: null })] };
    const m = mergeSessionBank(local, head, {});
    expect(m.redemptions.length).toBe(2); // slot 100 collapses, l2 joins by id
  });

  it("a close-called session stays waived: its redemption is dropped even when the other side still holds it", () => {
    const head = { redemptions: [red("h1", "stsd:a", "2026-08-06")], missedSessions: [] };
    const local = { redemptions: [], missedSessions: [{ id: "m1", setmoreUid: "stsd:a", type: "closecall" }] };
    const m = mergeSessionBank(local, head, {});
    expect(m.redemptions).toEqual([]);
    expect(m.missedSessions.length).toBe(1);
  });

  it("a charged missed session is NOT a waiver — its redemption survives", () => {
    const head = { redemptions: [red("h1", "stsd:a", "2026-08-06")] };
    const local = { redemptions: [], missedSessions: [{ id: "m1", setmoreUid: "stsd:a", type: "charged" }] };
    const m = mergeSessionBank(local, head, {});
    expect(m.redemptions.length).toBe(1);
  });
});

describe("mergeSessionBank packages and credits", () => {
  it("packages union by id — a package granted on another device can never vanish under this push", () => {
    const head = { packages: [{ id: "p1", sessions: 8, price: 680 }] };
    const local = { packages: [{ id: "p2", sessions: 4, price: 340 }] };
    const m = mergeSessionBank(local, head, {});
    expect(m.packages.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("on id collision the head copy wins for a background push, the local copy for a deliberate bank edit", () => {
    const head = { packages: [{ id: "p1", sessions: 8, paid: false }] };
    const local = { packages: [{ id: "p1", sessions: 8, paid: true }] };
    expect(mergeSessionBank(local, head, {}).packages[0].paid).toBe(false);
    expect(mergeSessionBank(local, head, { deliberate: true }).packages[0].paid).toBe(true);
  });

  it("credits union by id like packages", () => {
    const head = { credits: [{ id: "c1", n: 1 }] };
    const local = { credits: [{ id: "c2", n: 2 }] };
    expect(mergeSessionBank(local, head, {}).credits.length).toBe(2);
  });
});

describe("mergeSessionBank scalars and the rest", () => {
  it("rate/membership follow the head for background pushes and the local copy for deliberate edits", () => {
    const head = { rate: 85, membership: "gold" };
    const local = { rate: 0, membership: undefined };
    expect(mergeSessionBank(local, head, {})).toMatchObject({ rate: 85, membership: "gold" });
    const edited = mergeSessionBank({ rate: 90, membership: "silver" }, head, { deliberate: true });
    expect(edited).toMatchObject({ rate: 90, membership: "silver" });
  });

  it("a scalar only one side carries is kept regardless of mode", () => {
    expect(mergeSessionBank({ rollover: true }, {}, {}).rollover).toBe(true);
    expect(mergeSessionBank({}, { autoRenew: true }, { deliberate: true }).autoRenew).toBe(true);
  });

  it("upcomingBookings stay the local device's — a rebuilt display mirror, not a ledger", () => {
    const head = { upcomingBookings: [{ uid: "old", date: "2026-08-11" }] };
    const local = { upcomingBookings: [{ uid: "new", date: "2026-08-24" }] };
    expect(mergeSessionBank(local, head, {}).upcomingBookings).toEqual(local.upcomingBookings);
  });

  it("messages and bulletins union by id, head wins collisions", () => {
    const head = { messages: [{ id: "m1", text: "a" }] };
    const local = { messages: [{ id: "m1", text: "edited" }, { id: "m2", text: "b" }] };
    const m = mergeSessionBank(local, head, {});
    expect(m.messages.length).toBe(2);
    expect(m.messages.find((x) => x.id === "m1").text).toBe("a");
  });

  it("a missing side hands back the other, and inputs are never mutated", () => {
    const local = { redemptions: [red("l1", "stsd:a", "2026-08-06")] };
    expect(mergeSessionBank(local, null, {}).redemptions.length).toBe(1);
    expect(mergeSessionBank(null, local, {}).redemptions.length).toBe(1);
    const headFrozen = Object.freeze({ redemptions: Object.freeze([red("h1", "stsd:x", "2026-08-01")]) });
    const localFrozen = Object.freeze({ redemptions: Object.freeze([red("l1", "stsd:y", "2026-08-02")]) });
    expect(() => mergeSessionBank(localFrozen, headFrozen, {})).not.toThrow();
  });
});
