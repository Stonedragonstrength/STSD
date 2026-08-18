// Extracted from app.js — Phase 1 of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/sync/merge-logs.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
// When Vite lands (Phase 5) the namespace footer becomes `export` and nothing
// else changes.
(function () {
  "use strict";

  // Stage-1 client edition of the merge that Stage 2 moves into the database,
  // for the one catastrophic-loss family: per exercise, union entries by id;
  // both sides carrying the same id → higher `m` (entry-modified ms, absent =
  // 0, local wins ties — the device in hand is the one being edited) wins. A
  // cloud copy can never erase a local entry it hasn't seen, and vice versa.
  function mergeExerciseLogs(localLogs, cloudLogs) {
    const out = {};
    const exIds = new Set([...Object.keys(localLogs || {}), ...Object.keys(cloudLogs || {})]);
    for (const exId of exIds) {
      const byId = new Map();
      for (const src of [cloudLogs?.[exId], localLogs?.[exId]]) {
        for (const e of Array.isArray(src) ? src : []) {
          if (!e) continue;
          const k = e.id || `d:${e.date}`;
          const cur = byId.get(k);
          if (!cur || (e.m || 0) >= (cur.m || 0)) byId.set(k, e);
        }
      }
      out[exId] = [...byId.values()];
    }
    return out;
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.sync = Object.assign(NS.sync || {}, { mergeExerciseLogs });
})();
