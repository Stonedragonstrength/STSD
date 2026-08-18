// Extracted from app.js — Phase 4 (Scheduling) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/scheduling/merge.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// THE GATED MODULE (design doc §6): extraction was held until the owner
// ruled on the merge rules. Ruled 2026-08-18: FROZEN AS SHIPPED — the rules
// below are the ones the August incidents settled (19 double charges across
// 14 athletes, and the cancelled-booking slot handback of 4 August), and
// the tests now pin them so no future change can quietly weaken them.
//
// slotsMatch is the ONE slot-identity everywhere money moves: same or
// adjacent minute bucket is the same session. mirrorEventsToKeep is the
// dashboard union's decide half, lifted verbatim from
// loadDashCalSetmoreEvents (three token changes: the cutoff and the athlete
// matcher became parameters, and the filter is returned) — the spec's
// wiring layer pins the call site so the two cannot drift apart.
(function () {
  "use strict";
  // A slot is a minute bucket (Math.floor(ms / 60000)), and bucket EQUALITY
  // is a trap: 08:59:59 and 09:00:01 are the same session two seconds apart,
  // in different buckets. Adjacent buckets match too — a drift under two
  // minutes can only be one session, because real sessions sit at least
  // fifteen minutes apart. This is the guard whose miss produced the Setmore
  // double-charges, so every slot comparison uses this rather than ===.
  function slotsMatch(a, b) {
    if (a == null || b == null) return false;
    return Math.abs(Number(a) - Number(b)) <= 1;
  }

  // Which mirrored Setmore events the calendar may still believe, given the
  // native bookings. events/native are the two fetched lists; cutoffMs is
  // setmoreCutoffMs(); matchAthlete resolves a mirror event to an athlete.
  function mirrorEventsToKeep(events, native, cutoffMs, matchAthlete) {
    // Past the cut-over the app's own bookings are the truth. The mirror still
    // holds every session that happened BEFORE it, which is the only record of
    // those, so it is filtered rather than ignored — otherwise the same session
    // would show twice, and the auto-redeem walker would charge for it twice.
    //
    // THE CUTOFF ALONE WASN'T ENOUGH, and this is how we found out: 19 double
    // charges across 14 athletes in the four days after the lock-in, every one
    // of them a native booking and a mirrored Setmore event for the same slot.
    // `setmoreCutoffMs()` falls back to **Infinity** when the cached
    // availability has no cutoff on it — which is any device that hasn't pulled
    // the coach row since the cut-over — and Infinity keeps every mirrored
    // event, including the ones the lock-in had already turned into bookings.
    //
    // So the native booking now wins on any slot it covers, whatever the cutoff
    // says. Keyed on athlete + start MINUTE, and matched with slotsMatch's
    // adjacent-bucket tolerance: a bucket EQUALITY put 08:59:59 and 09:00:01
    // in different buckets, so a second's drift across a minute boundary
    // undid the dedupe. Never on the formatted time — that string carries a
    // narrow no-break space before AM/PM.
    //
    // NB the slot set is built from EVERY native booking, cancelled ones
    // included, while only the booked ones become calendar events. Once the app
    // owns a slot the mirror is dead for it whatever happens next — otherwise
    // cancelling a booking HANDS THE SLOT BACK to the mirror, which then
    // charges for a session the coach just cancelled. That is exactly what
    // happened to two athletes on 4 August.
    const minuteOf = (startAt) => Math.floor(new Date(startAt).getTime() / 60000);
    const nativeSlots = new Set((native || []).map((b) => `${b.athlete_id}|${minuteOf(b.start_at)}`));
    // The set holds exact buckets; the probe asks for the neighbours too,
    // which is slotsMatch's tolerance spelled as three lookups.
    const slotTaken = (athleteId, startAt) => {
      const m = minuteOf(startAt);
      return nativeSlots.has(`${athleteId}|${m - 1}`) ||
        nativeSlots.has(`${athleteId}|${m}`) ||
        nativeSlots.has(`${athleteId}|${m + 1}`);
    };
    return (events || []).filter((e) => {
      if (new Date(e.startAt).getTime() >= cutoffMs) return false;
      const who = matchAthlete(e);
      return !who || !slotTaken(who.id, e.startAt);
    });
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.scheduling = Object.assign(NS.scheduling || {}, {
    slotsMatch, mirrorEventsToKeep,
  });
})();
