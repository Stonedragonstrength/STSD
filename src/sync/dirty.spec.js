// The unsynced-athlete dirty flags — the guard that keeps a push that never
// landed from being silently reverted by the next boot's cloud refresh.
//
// The deferred brick (design doc §5): held to the end of the programme
// because a duplicated singleton makes a guard like this a no-op with no
// error. It is safe HERE because the store is localStorage — every reader
// and writer shares the same store whichever copy of the functions runs —
// and this spec pins exactly that: state round-trips through the store, not
// through module memory.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import "./dirty.js";

const { dirtyAthletes, markAthleteDirty, clearAthleteDirty } = globalThis.STSD.sync;

const KEY = "trainerpro_athletes_dirty_v1";

// Node has no localStorage; the fake counts writes so the write-avoidance
// rules are observable, not just the end state.
let store, writes;
const prevLS = globalThis.localStorage;
beforeEach(() => {
  store = new Map();
  writes = 0;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { writes++; store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
});
afterAll(() => { globalThis.localStorage = prevLS; });

describe("the dirty flags", () => {
  it("mark, read, clear — one athlete's flag round-trips through the STORE", () => {
    markAthleteDirty("a1");
    expect(dirtyAthletes()).toEqual({ a1: true });
    // The claim that makes this brick safe: the truth is in localStorage.
    expect(JSON.parse(store.get(KEY))).toEqual({ a1: true });
    clearAthleteDirty("a1");
    expect(dirtyAthletes()).toEqual({});
  });

  it("flags are per athlete — clearing one leaves the other", () => {
    markAthleteDirty("a1");
    markAthleteDirty("a2");
    clearAthleteDirty("a1");
    expect(dirtyAthletes()).toEqual({ a2: true });
  });

  it("marking an already-dirty athlete writes nothing", () => {
    markAthleteDirty("a1");
    const before = writes;
    markAthleteDirty("a1");
    expect(writes).toBe(before);
  });

  it("clearing a clean athlete writes nothing", () => {
    const before = writes;
    clearAthleteDirty("never-marked");
    expect(writes).toBe(before);
  });

  it("a missing id is a no-op, not a phantom flag", () => {
    markAthleteDirty("");
    markAthleteDirty(null);
    expect(dirtyAthletes()).toEqual({});
    expect(writes).toBe(0);
  });

  it("an empty store reads as no flags", () => {
    expect(dirtyAthletes()).toEqual({});
  });

  it("a corrupted store reads as no flags, never a throw", () => {
    store.set(KEY, "{not json");
    expect(dirtyAthletes()).toEqual({});
    // And the guard self-heals on the next mark.
    markAthleteDirty("a1");
    expect(dirtyAthletes()).toEqual({ a1: true });
  });
});
