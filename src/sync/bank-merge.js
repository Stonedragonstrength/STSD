// The session-bank merge behind upsertAthlete's rebase (2026-08-19).
//
// Why this exists: the athletes row is pushed WHOLE, last write wins. When a
// device loses the rev race, the retry used to overwrite the head wholesale —
// which is how Leo Frostholm's packages and three weeks of session charges
// vanished from the cloud with no error and no toast. On a rebase, the retry
// now carries the UNION of both banks: money that ever landed cannot be
// silently erased by a slower device.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; cloud.js pulls it at the top of its
// IIFE (the same load-bearing position as the push queue), and
// src/sync/bank-merge.spec.js imports THIS file, so the shipped code is the
// tested code.
//
// The one deliberate asymmetry: deletions can resurrect. A package removed on
// one device while another still holds a copy comes back on the next race —
// visibly (the balance jumps UP), and trivially re-deleted. The failure this
// kills is the invisible one. The single exception is the close-call waiver,
// which has a natural tombstone: waiving writes a missedSessions entry of
// type "closecall", so a waived charge stays waived through any merge.
(function () {
  "use strict";

  const arr = (x) => (Array.isArray(x) ? x : []);

  // Union two lists by an identity function. Head entries come first and win
  // id collisions unless preferLocal; local-only entries append after.
  function unionBy(headList, localList, identity, preferLocal) {
    const out = [];
    const seen = new Map(); // identity -> index in out
    arr(headList).forEach((x) => {
      if (!x) return;
      const k = identity(x);
      seen.set(k, out.length);
      out.push(x);
    });
    arr(localList).forEach((x) => {
      if (!x) return;
      const k = identity(x);
      if (seen.has(k)) {
        if (preferLocal) out[seen.get(k)] = x;
        return;
      }
      seen.set(k, out.length);
      out.push(x);
    });
    return out;
  }

  // One redemption per real session, whatever id it was charged under on
  // whichever device: the booking uid names it best, then the slot (the
  // minute it started), then the entry's own id.
  const redemptionKey = (r) =>
    r.setmoreUid ? `uid:${r.setmoreUid}` :
    r.slot != null ? `slot:${r.slot}` :
    `id:${r.id}`;
  const missedKey = (m) =>
    m.setmoreUid ? `uid:${m.setmoreUid}|${m.type || ""}` : `id:${m.id}`;
  const byId = (x) => `id:${x.id}`;

  // opts.deliberate: this push carries an on-purpose bank edit (grant, rate
  // change, tier change) — the local copy speaks for the coach's intent, so
  // it wins scalar fields and id collisions. Background pushes (program
  // edits, mirrors, auto-charges) defer to the head instead.
  function mergeSessionBank(localBank, headBank, opts = {}) {
    if (!headBank || typeof headBank !== "object") return localBank || null;
    if (!localBank || typeof localBank !== "object") return headBank;
    const deliberate = !!opts.deliberate;

    // Scalars: the deliberate side wins; a value only one side carries is
    // kept either way (undefined never beats a real value).
    const pick = (a, b) => (a !== undefined ? a : b);
    const winner = deliberate ? localBank : headBank;
    const loser = deliberate ? headBank : localBank;

    const merged = {
      // Unknown/extra keys ride along, loser first so the winner overwrites.
      ...loser,
      ...winner,
      rate: pick(winner.rate, loser.rate),
      flatRate: pick(winner.flatRate, loser.flatRate),
      membership: pick(winner.membership, loser.membership),
      autoRenew: pick(winner.autoRenew, loser.autoRenew),
      rollover: pick(winner.rollover, loser.rollover),
      redemptions: unionBy(headBank.redemptions, localBank.redemptions, redemptionKey, deliberate),
      missedSessions: unionBy(headBank.missedSessions, localBank.missedSessions, missedKey, deliberate),
      packages: unionBy(headBank.packages, localBank.packages, byId, deliberate),
      credits: unionBy(headBank.credits, localBank.credits, byId, deliberate),
      messages: unionBy(headBank.messages, localBank.messages, byId, false),
      bulletins: unionBy(headBank.bulletins, localBank.bulletins, byId, false),
      // A display mirror the pushing device rebuilds constantly, not a
      // ledger: the local copy is the freshest and unioning would only
      // resurrect stale rows.
      upcomingBookings: arr(localBank.upcomingBookings).length || localBank.upcomingBookings
        ? localBank.upcomingBookings
        : headBank.upcomingBookings,
    };

    // The close-call waiver survives any merge: a redemption whose session
    // was waived on EITHER side stays dropped, or forgiving a session on one
    // phone would quietly re-charge it from another.
    const waived = new Set(
      merged.missedSessions.filter((m) => m && m.type === "closecall" && m.setmoreUid)
        .map((m) => m.setmoreUid));
    if (waived.size) {
      merged.redemptions = merged.redemptions.filter((r) => !waived.has(r.setmoreUid));
    }
    return merged;
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.sync = Object.assign(NS.sync || {}, { mergeSessionBank });
})();
