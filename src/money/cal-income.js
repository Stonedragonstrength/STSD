// The Overview calendar's income summary (2026-08-19, Nathan's ask): for
// the frame the calendar is showing (one day, one week, one month), the
// income each category's sessions represent and the total of all of them.
// Pure aggregation — the caller decides the dates, supplies the calendar's
// own event map, and prices/labels each event through `resolve`, so this
// sums exactly what the calendar draws, priced exactly how the Income card
// prices, grouped exactly how Books cuts.
//
// Loaded as a classic script (no bundler ships yet); assigns onto the STSD
// namespace, and src/money/cal-income.spec.js imports THIS file, so the
// shipped code is the tested code.
(function () {
  "use strict";

  // dates: ISO days of the visible frame.
  // eventsByDate: { iso: [event] } — the calendar's own byDate map.
  // resolve(e): null when the event has no athlete (unlinked), else
  //   { label, rate } — the category label and that athlete's per-session
  //   rate (0 = athlete has no rate set).
  // Returns { groups, sessions, amount, unlinked, unpriced }:
  //   groups   — [{ label, sessions, amount }], amount desc, ties by label
  //   sessions — every session in the frame, unlinked included
  //   amount   — the grand total (unlinked contribute nothing)
  //   unlinked — sessions with no athlete
  //   unpriced — resolved sessions whose rate is 0
  function calIncomeSummary(dates, eventsByDate, resolve) {
    const by = new Map();
    let sessions = 0, amount = 0, unlinked = 0, unpriced = 0;
    (dates || []).forEach((iso) => {
      (((eventsByDate || {})[iso]) || []).forEach((e) => {
        if (!e) return;
        sessions++;
        const r = resolve(e);
        if (!r) { unlinked++; return; }
        const rate = Number(r.rate) || 0;
        const g = by.get(r.label) || { label: r.label, sessions: 0, amount: 0 };
        g.sessions++;
        g.amount += rate;
        by.set(r.label, g);
        amount += rate;
        if (!(rate > 0)) unpriced++;
      });
    });
    const groups = [...by.values()].sort((a, b) =>
      (b.amount - a.amount) || a.label.localeCompare(b.label));
    return { groups, sessions, amount, unlinked, unpriced };
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.money = Object.assign(NS.money || {}, { calIncomeSummary });
})();
