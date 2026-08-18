// Extracted from app.js — Phase 1 of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/sync/roster-progress.spec.js
// imports THIS file and reads the namespace, so the shipped code is the
// tested code.
//
// CONTRACT (design doc §4, rule 5): the identity return is load-bearing.
// pullProgressFromCloud tests `next !== c.importedProgress` to decide
// whether to repaint, so "unchanged" must come back as the SAME object —
// never a fresh copy, however equal.
(function () {
  "use strict";

  // From src/sync/merge-logs.js, which index.html loads first (the boot
  // smoke executes the tags in that order, so a reorder fails the suite
  // before it fails a phone). Checked at load so a missing or misordered
  // tag fails HERE, by name, not silently mid-pull.
  const { mergeExerciseLogs } = globalThis.STSD.sync;
  if (typeof mergeExerciseLogs !== "function") {
    throw new Error("src/sync/merge-logs.js must load before roster-progress.js");
  }

  // What a coach-side athlete keeps as importedProgress after a cloud read.
  // Cloud row present → adopt it, but union exerciseLogs through
  // mergeExerciseLogs (a pull can never erase local work) — and never while
  // an unconfirmed coach write owns the local copy (_coachProgressDirtyAt).
  // Cloud row ABSENT → keep the local copy, identity-returned so callers can
  // tell "unchanged". Shared by pullProgressFromCloud (one athlete, on open)
  // and populateCoachFromCloud (whole roster): the latter used to adopt the
  // athletes-table rows wholesale, whose importedProgress is always null, so
  // every boot and resync wiped the roster back to "No sync" until each
  // athlete was opened one at a time.
  function mergedRosterProgress(localProgress, cloudProgress, progressDirty) {
    if (cloudProgress && !progressDirty) {
      return {
        ...cloudProgress,
        exerciseLogs: mergeExerciseLogs(localProgress?.exerciseLogs, cloudProgress.exerciseLogs),
        syncedAt: Date.now(),
      };
    }
    return localProgress || null;
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.sync = Object.assign(NS.sync || {}, {
    mergedRosterProgress,
  });
})();
