// Extracted from app.js — Phase 1's deliberately DEFERRED brick (design doc
// §5: the dirty flags were held to the very end of the programme, because a
// duplicated singleton makes the guard a no-op with no error). See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/sync/dirty.spec.js imports THIS
// file and reads the namespace, so the shipped code is the tested code.
//
// Why this one is safe to move at all: the flag store is localStorage, not a
// module-level cell — every reader and writer in every call stack shares the
// SAME store whichever copy of these functions they call. The functions read
// it at CALL time, never cache it.
(function () {
  "use strict";

  const KEY_ATHLETES_DIRTY = "trainerpro_athletes_dirty_v1";

  // ── Unsynced-athlete protection ──
  // Every coach boot refreshes athletes from the cloud and replaces the local
  // list. Cloud writes fail silently by design (offline always works), so a
  // push that never landed used to be reverted on the next open with no
  // warning — a program assigned on flaky signal would simply vanish.
  // Templates already had this guard via KEY_TEMPLATES_DIRTY; athletes didn't.
  // An athlete stays marked dirty until the cloud confirms the write, and a
  // dirty athlete's local copy survives the refresh. See populateCoachFromCloud.
  function dirtyAthletes() {
    try { return JSON.parse(localStorage.getItem(KEY_ATHLETES_DIRTY)) || {}; }
    catch { return {}; }
  }
  function markAthleteDirty(id) {
    if (!id) return;
    const d = dirtyAthletes();
    if (d[id]) return;
    d[id] = true;
    localStorage.setItem(KEY_ATHLETES_DIRTY, JSON.stringify(d));
  }
  function clearAthleteDirty(id) {
    const d = dirtyAthletes();
    if (!d[id]) return;
    delete d[id];
    localStorage.setItem(KEY_ATHLETES_DIRTY, JSON.stringify(d));
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.sync = Object.assign(NS.sync || {}, {
    dirtyAthletes, markAthleteDirty, clearAthleteDirty,
  });
})();
