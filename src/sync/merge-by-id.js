// Extracted from app.js — Phase 1 of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/sync/merge-by-id.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// The template merge and the tombstone family live together deliberately:
// a tombstone only works BECAUSE mergeById treats it as the newest version
// of its id, and splitting them apart would hide that dependency.
(function () {
  "use strict";

  // How much filled-in prescription a template holds: exercises that carry a
  // weight, a rep count or a progression rule. NOT a count of exercises —
  // adding the lifts is a minute's work and typing their numbers is an hour's,
  // and it is the hour that keeps getting lost.
  function filledPrescriptions(tpl) {
    let n = 0;
    (tpl?.weeks || []).forEach((w) => (w.days || []).forEach((d) => (d.exercises || []).forEach((e) => {
      if (String(e?.currentWeight ?? "") !== "" || String(e?.currentReps ?? "") !== "" || e?.progression) n++;
    })));
    return n;
  }

  // Union two lists of {id,...} — cloud entries first so their order is kept,
  // local-only entries appended so a template created here but not yet pushed
  // survives the refresh. For shared ids the NEWER updatedAt stamp wins, and a
  // stamped copy always beats an unstamped one. This is what stops a device
  // that has been closed for a week from resurrecting last week's copy of
  // every template the moment it reconnects: it used to win wholesale ("local
  // holds the unsynced edit"), which is how two fully built programs were
  // flattened to stubs on 2026-08-12. Unstamped vs unstamped keeps the old
  // local-wins behavior, only reachable for templates untouched since stamps
  // shipped.
  // opts.prefer decides ties (both copies unstamped): "local" while unsynced
  // edits exist — they hold the change — and "cloud" on a clean pull, which
  // was that path's old wholesale behavior. opts.keepLocalOnly appends
  // local-only ids; a clean pull leaves it off so a template deleted on
  // another device stays deleted.
  function mergeById(cloudList, localList, opts) {
    const o = opts || {};
    const prefer = o.prefer || "local";
    const keepLocalOnly = o.keepLocalOnly !== false;
    const local = Array.isArray(localList) ? localList : [];
    const cloud = Array.isArray(cloudList) ? cloudList : [];
    const byId = new Map(local.map((t) => [t.id, t]));
    const rescued = [];
    const out = cloud.map((t) => {
      const mine = byId.get(t.id);
      if (!mine) return t;
      const tu = Number(t.updatedAt) || 0, mu = Number(mine.updatedAt) || 0;
      let win = mu > tu ? mine : tu > mu ? t : (prefer === "local" ? mine : t);
      const lose = win === mine ? t : mine;
      // The timestamps are not trustworthy enough to throw work away on. They
      // are stamped in exactly ONE place — saveTrainer, and only while the
      // program editor is open — so a template can be edited without its stamp
      // moving, and an older snapshot can then out-rank the newer copy.
      // Content is not ambiguous in the same way. If the copy about to lose
      // holds MORE filled-in prescription than the winner, the stamp is lying,
      // and the fuller copy is kept.
      //
      // What this cost on 2026-08-17: a program built Day 2 first, then Day 1.
      // A snapshot from between those two states — Day 1's lifts added but not
      // yet numbered, Day 2 finished — won a merge and became the truth. Seven
      // exercises' weights, reps and progression rules, gone silently.
      //
      // Tombstones are exempt: a deleted template legitimately holds nothing,
      // and preferring the fuller side there would resurrect it on every pull,
      // which is the whole reason tombstones exist (see the tombstone specs).
      if (!t?.deleted && !mine?.deleted) {
        const fw = filledPrescriptions(win), fl = filledPrescriptions(lose);
        if (fl > fw) {
          rescued.push({ id: t.id, name: lose.name || t.name || "a program", kept: fl, wouldHave: fw });
          win = lose;
        }
      }
      return win;
    });
    if (rescued.length && typeof o.onRescue === "function") {
      try { o.onRescue(rescued); } catch (e) { /* reporting must never break a merge */ }
    }
    if (keepLocalOnly) {
      const seen = new Set(cloud.map((t) => t.id));
      local.forEach((t) => { if (!seen.has(t.id)) out.push(t); });
    }
    return out;
  }

  // Deleting a template has to leave a trace, or sync undoes it: mergeById
  // reads a missing id as "created on the other device" and resurrects it on
  // the next pull. That is exactly what kept happening on the phone — the
  // 1.5s debounced push dies when the page reloads or the PWA is
  // backgrounded, so the cloud never hears about the delete, the boot pull
  // brings the template back, and the dirty-flag re-push cements it. So
  // delete swaps the entry for a stamped tombstone: newest-wins carries the
  // deletion through every merge path, and whichever push eventually lands
  // records it in the cloud. Render paths read through liveTemplates();
  // tombstones older than 30 days are purged at boot, by which time every
  // device has synced past them. (The known hole is a device that sleeps
  // longer than the purge window and then pushes its stale array — the same
  // window the 2026-08-12 stamp work accepted.)
  function deleteTemplateById(list, id) {
    return (list || []).map((t) =>
      t.id === id ? { id: t.id, name: t.name, deleted: true, updatedAt: Date.now() } : t);
  }
  function liveTemplates(list) {
    return (list || []).filter((t) => !t.deleted);
  }
  function purgeTemplateTombstones(list) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return (list || []).filter((t) => !t.deleted || (Number(t.updatedAt) || 0) > cutoff);
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.sync = Object.assign(NS.sync || {}, {
    filledPrescriptions,
    mergeById,
    deleteTemplateById,
    liveTemplates,
    purgeTemplateTombstones,
  });
})();
