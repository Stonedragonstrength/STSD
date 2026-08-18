// Extracted from app.js — Phase 4 (Scheduling) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/scheduling/availability.spec.js
// imports THIS file and reads the namespace, so the shipped code is the
// tested code.
//
// The availability core: the coach's recurring wall-clock windows and what
// they imply. normalizeAvailability carries TWO load-bearing rules — the
// half-filled-window-closes-the-day reading, and the legacy days-off
// adoption whose bo_<date> id is derived from the date ON PURPOSE (design
// doc §4 rule 5: that derivation is what makes adoption idempotent when a
// cloud refresh hands the old blackouts array back). generateSlots is pure
// and shared by BOTH sides — the coach's quick-picks and the athlete's grid
// are the same call. blackoutsMirrorOf is the mirror rebuild lifted from
// saveCoachAvailability (wiring-pinned): every all-day block's dates,
// written purely for cached PWAs on the previous build, which honour
// blackouts and have never heard of blocks.
//
// uid (block ids) and dateISO come through the STSD.app getters at CALL
// time; the zone and weekday maths come off the namespace at load, loudly.
(function () {
  "use strict";

  function uid() {
    return globalThis.STSD.app.uid();
  }
  function dateISO(d) {
    return globalThis.STSD.app.dateISO(d);
  }

  // From src/scheduling/zone.js and series.js, which index.html loads first
  // (the boot smoke executes the tags in that order). Checked at load so a
  // missing or misordered tag fails HERE, by name.
  const { localTz, parseHM, zonedTimeToUtc, zonedDateISO, dowOfISO } =
    globalThis.STSD?.scheduling || {};
  [["localTz", localTz], ["parseHM", parseHM], ["zonedTimeToUtc", zonedTimeToUtc],
   ["zonedDateISO", zonedDateISO], ["dowOfISO", dowOfISO]].forEach(([name, fn]) => {
    if (typeof fn !== "function") {
      throw new Error(`zone.js and series.js must load before availability.js (missing ${name})`);
    }
  });
  // ================= Scheduling =================
  // The coach writes recurring WALL-CLOCK windows ("Mondays 06:00-11:00") plus
  // the zone they mean them in, never instants — that is what makes the
  // schedule survive a DST change instead of sliding an hour. Bookable slots
  // are generated from those windows on demand, on whichever side is asking,
  // and both sides must agree exactly, so `generateSlots` is pure.
  const DEFAULT_AVAILABILITY = {
    tz: "",
    sessionMins: 60,
    bufferMins: 0,
    leadHours: 12,   // an athlete may not book closer than this to the start
    cancelHours: 24, // ...nor cancel or move one unaided inside this; they ask
    horizonDays: 21, // how far ahead slots are offered
    weekly: {},      // { "1": [{ start:"06:00", end:"11:00" }] }, 0 = Sunday
    blackouts: [],   // ["2026-08-03"] whole days off
    extra: [],       // [{ date:"2026-08-09", start:"08:00", end:"10:00" }] one-offs
    // Time the coach has closed. `extra` opens hours; this shuts them.
    // [{ id, date, endDate, allDay, start, end, label }] — date..endDate is
    // inclusive, and allDay ignores start/end. Every all-day block is ALSO
    // written into `blackouts`, because a cached PWA is running the build
    // before this one and that build honours blackouts and has never heard of
    // blocks. A timed block has no blackouts equivalent and only the current
    // build subtracts it; blacking out the whole day for stale clients would
    // cost far more bookings than the gap does.
    blocks: [],
  };

  function normalizeAvailability(av) {
    const a = { ...DEFAULT_AVAILABILITY, ...(av || {}) };
    a.tz = a.tz || localTz();
    a.sessionMins = Math.max(15, Math.min(240, parseInt(a.sessionMins, 10) || 60));
    a.bufferMins = Math.max(0, Math.min(120, parseInt(a.bufferMins, 10) || 0));
    a.leadHours = Math.max(0, Math.min(168, parseFloat(a.leadHours) || 0));
    // Not `|| 24`: 0 is a real answer meaning "cancel whenever you like", and
    // the usual falsy fallback would silently overrule the coach who picked it.
    a.cancelHours = Math.max(0, Math.min(168,
      a.cancelHours == null || a.cancelHours === "" || isNaN(parseFloat(a.cancelHours))
        ? 24 : parseFloat(a.cancelHours)));
    a.horizonDays = Math.max(1, Math.min(90, parseInt(a.horizonDays, 10) || 21));
    a.weekly = a.weekly && typeof a.weekly === "object" ? a.weekly : {};
    a.blackouts = Array.isArray(a.blackouts) ? a.blackouts : [];
    a.extra = Array.isArray(a.extra) ? a.extra : [];
    a.blocks = (Array.isArray(a.blocks) ? a.blocks : [])
      .filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(b.date))
      .map((b) => ({
        id: b.id || uid(),
        date: b.date,
        // A block that never learned to span days is a one-day block.
        endDate: /^\d{4}-\d{2}-\d{2}$/.test(b.endDate) && b.endDate > b.date ? b.endDate : b.date,
        // Half-filled times would silently subtract nothing, so anything that
        // doesn't parse as a real window closes the whole day instead — the
        // safer reading of "I am not available".
        allDay: !!b.allDay || !parseHM(b.start) || !parseHM(b.end) || !(b.end > b.start),
        start: b.start || "",
        end: b.end || "",
        label: String(b.label || "").slice(0, 60),
      }));
    // Legacy whole-day "Days off" are all-day blocks that predate the shape.
    // They are ADOPTED rather than kept alongside, so the sheet, the calendar
    // and the availability editor all edit one list — and so removing one
    // actually removes it. The id is derived from the date, which makes the
    // adoption stable across reloads and idempotent on a cloud refresh that
    // hands back the old array.
    const covered = new Set();
    a.blocks.forEach((b) => { if (b.allDay) blockDates(b).forEach((d) => covered.add(d)); });
    a.blackouts.forEach((d) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || covered.has(d)) return;
      covered.add(d);
      a.blocks.push({ id: `bo_${d}`, date: d, endDate: d, allDay: true, start: "", end: "", label: "" });
    });
    return a;
  }
  // Every date a block covers, inclusive. Capped so a typo in the end date
  // can't spin the slot generator.
  function blockDates(b) {
    const out = [];
    const d = new Date(b.date + "T12:00:00");
    const end = new Date((b.endDate || b.date) + "T12:00:00");
    for (let i = 0; i < 400 && +d <= +end; i++) {
      out.push(dateISO(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  // True once the coach has written any window at all — nothing is bookable
  // before that, and the athlete gets told so rather than shown an empty list.
  function availabilityIsSet(av) {
    const a = normalizeAvailability(av);
    return Object.values(a.weekly).some((w) => Array.isArray(w) && w.length) || a.extra.length > 0;
  }

  // Past this point an athlete can no longer act on a booking alone: they ask,
  // and the coach approves or turns it down. Mirrors slotBookingClosed() for
  // open slots. This only decides which buttons get drawn — the same rule is
  // enforced by the bookings_guard trigger, which matters because an installed
  // PWA can still be serving the build that had an unguarded Cancel button.
  // `nowMs` is injectable only so the spec can pin a clock; the app never
  // passes it.
  function cancelWindowClosed(startMs, av, nowMs = Date.now()) {
    const a = normalizeAvailability(av);
    if (!a.cancelHours) return false;
    return nowMs >= startMs - a.cancelHours * 3600000;
  }

  // Every slot the availability implies in [fromMs, fromMs + days), minus the
  // lead time and minus anything in `busy` (existing bookings, and the coach's
  // Google Calendar when it's connected). Pure — see the Node harness.
  function generateSlots(av, fromMs, days, busy) {
    const a = normalizeAvailability(av);
    const tz = a.tz;
    const lenMs = a.sessionMins * 60000;
    const stepMs = (a.sessionMins + a.bufferMins) * 60000;
    const earliest = fromMs + a.leadHours * 3600000;
    // An all-day block shuts its dates the same way a blackout does, so the two
    // ways of saying "I'm off that day" stay one code path from here down.
    const blackouts = new Set(a.blackouts);
    a.blocks.forEach((b) => { if (b.allDay) blockDates(b).forEach((d) => blackouts.add(d)); });
    const seen = new Set();
    const out = [];
    for (let i = 0; i < days; i++) {
      const dayISO = zonedDateISO(fromMs + i * 86400000, tz);
      if (blackouts.has(dayISO)) continue;
      const [y, m, d] = dayISO.split("-").map(Number);
      const dow = dowOfISO(dayISO);
      const windows = [
        ...(Array.isArray(a.weekly[String(dow)]) ? a.weekly[String(dow)] : []),
        ...a.extra.filter((e) => e && e.date === dayISO),
      ];
      windows.forEach((w) => {
        const s = parseHM(w && w.start), e = parseHM(w && w.end);
        if (!s || !e) return;
        const winStart = zonedTimeToUtc(y, m, d, s.hh, s.mm, tz);
        const winEnd = zonedTimeToUtc(y, m, d, e.hh, e.mm, tz);
        if (winEnd <= winStart) return;
        for (let t = winStart; t + lenMs <= winEnd; t += stepMs) {
          if (t < earliest || seen.has(t)) continue;
          seen.add(t);
          out.push({ startMs: t, endMs: t + lenMs });
        }
      });
    }
    // Timed blocks join the busy list rather than getting a filter of their
    // own: a closed hour and a booked hour are the same fact to a slot, and
    // folding them here is what makes every caller — the coach's quick-picks,
    // the athlete's grid, the Node harness — honour them without changing.
    // Read in the coach's zone, like the windows they are subtracted from.
    const timed = [];
    a.blocks.forEach((b) => {
      if (b.allDay) return;
      const s = parseHM(b.start), e = parseHM(b.end);
      if (!s || !e) return;
      blockDates(b).forEach((dISO) => {
        const [y, m, d] = dISO.split("-").map(Number);
        const bs = zonedTimeToUtc(y, m, d, s.hh, s.mm, tz);
        const be = zonedTimeToUtc(y, m, d, e.hh, e.mm, tz);
        if (be > bs) timed.push({ s: bs, e: be });
      });
    });
    const busyList = (busy || [])
      .map((b) => ({ s: +new Date(b.start), e: +new Date(b.end) }))
      .filter((b) => isFinite(b.s) && isFinite(b.e) && b.e > b.s)
      .concat(timed);
    return out
      .filter((o) => !busyList.some((b) => o.startMs < b.e && b.s < o.endMs))
      .sort((x, z) => x.startMs - z.startMs);
  }

  // The blackouts MIRROR, lifted from saveCoachAvailability: every date an
  // all-day block covers, sorted. Rebuilt from the blocks on every save so
  // the two can never disagree — and rebuilt from what is LEFT, so removing
  // a block actually sticks. A timed block deliberately writes nothing: the
  // old shape cannot say “an hour closed”, and blacking out the whole day
  // for stale clients would cost far more bookings than the gap does.
  function blackoutsMirrorOf(blocks) {
    const off = new Set();
    blocks.forEach((b) => { if (b.allDay) blockDates(b).forEach((d) => off.add(d)); });
    return [...off].sort();
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.scheduling = Object.assign(NS.scheduling || {}, {
    DEFAULT_AVAILABILITY, normalizeAvailability, blockDates,
    availabilityIsSet, cancelWindowClosed, generateSlots,
    blackoutsMirrorOf,
  });
})();
