// The auto-redeem sweep's charge plan (2026-08-19): which finished sessions
// in the loaded calendar window are chargeable, per the same guards the
// sweep has always applied — extracted pure so the decision is testable and
// so app.js can split the result into "charge now" (one fresh session) and
// "ask first" (a catch-up batch), instead of silently spending several
// tokens at once weeks after the fact (Leo, 2026-08-19: four in one run).
//
// Loaded as a classic script (no bundler ships yet); assigns onto the STSD
// namespace, and src/money/redeem-plan.spec.js imports THIS file, so the
// shipped code is the tested code.
(function () {
  "use strict";

  // events: the calendar's loaded window (mirrors + native, any athlete).
  // opts:
  //   since, now      — the watermark and the sweep instant (ms)
  //   resolve(e)      — the athlete a calendar event belongs to, or null
  //   bankOf(id)      — that athlete's live sessionBank (arrays present)
  //   slotsMatch(a,b) — the one slot identity everywhere money moves
  //   dateOf(e)       — local YYYY-MM-DD of the event's start
  //   noteOf(e)       — the redemption note ("Booked session · 5:30 PM")
  // Returns [{ athleteId, uid, date, slot, note }] in event order. Within-run
  // duplicates (a Setmore mirror and a native booking describing the same
  // real session) collapse through the same guards that block re-charging
  // across runs: planned charges count as existing ones.
  function redeemSweepPlan(events, opts) {
    const { since, now, resolve, bankOf, slotsMatch, dateOf, noteOf } = opts;
    const out = [];
    const plannedBy = new Map(); // athleteId -> planned entries this run
    (events || []).forEach((e) => {
      if (!e || !e.uid) return;
      const end = new Date(e.endAt || e.startAt).getTime();
      if (!(end > since && end <= now)) return;
      const c = resolve(e);
      if (!c) return;
      const bank = bankOf(c.id) || {};
      const reds = [...(bank.redemptions || []), ...(plannedBy.get(c.id) || [])];
      const date = dateOf(e);
      const slot = Math.floor(new Date(e.startAt).getTime() / 60000);
      const note = noteOf(e);
      if (reds.some((r) => r.setmoreUid === e.uid)) return;
      // A manual redemption the coach logged for that date speaks for it.
      if (reds.some((r) => !r.setmoreUid && r.date === date)) return;
      // ONE CHARGE PER SLOT, not per uid: the same real session can carry
      // two names (mirror + native), and the slot is the session.
      if (reds.some((r) => slotsMatch(r.slot, slot))) return;
      // Rows written before `slot` existed: identical date + note.
      if (reds.some((r) => r.date === date && r.note === note)) return;
      // Close-called sessions are waived, never auto-charged.
      if ((bank.missedSessions || []).some((m) => m.setmoreUid === e.uid && m.type === "closecall")) return;
      const charge = { athleteId: c.id, uid: e.uid, date, slot, note };
      out.push(charge);
      if (!plannedBy.has(c.id)) plannedBy.set(c.id, []);
      plannedBy.get(c.id).push(charge);
    });
    return out;
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.money = Object.assign(NS.money || {}, { redeemSweepPlan });
})();
