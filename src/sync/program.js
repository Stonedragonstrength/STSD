// Extracted from app.js — Phase 1 of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/sync/program.spec.js imports THIS
// file and reads the namespace, so the shipped code is the tested code.
//
// This is the object the ATHLETE's device runs on, built field by field from
// the coach's athlete record. The client block is an allowlist, not a
// spread, and that is a trap the spec pins from both sides: every field the
// athlete side reads must be on it, and nothing coach-private may be.
// (The spec parses this file's client block by its 8-space indentation —
// reformat the block and update the spec in the same commit.)
(function () {
  "use strict";

  function buildProgramFromAthlete(athlete) {
    return {
      kind: "tp-program", v: 2,
      clientId: athlete.id,
      trainerName: "",
      sharedAt: Date.now(),
      // The row rev this program was built from. Without it every boot left
      // the realtime guard at 0, so the first own-row echo after any reload
      // always applied — a wholesale program rebuild mid-whatever.
      _rev: Number(athlete._rev) || 0,
      client: {
        id: athlete.id,
        name: athlete.name,
        age: athlete.age,
        heightIn: athlete.heightIn,
        weightLb: athlete.weightLb,
        units: athlete.units === "kg" ? "kg" : "lb",
        goals: athlete.goals,
        // Their coverage map runs on their own device and needs their bands.
        // This list is an allowlist, not a spread — a field omitted here is
        // simply absent on the athlete side, and the two maps disagree in
        // silence.
        trainingLevel: athlete.trainingLevel || "",
        trainingPhase: athlete.trainingPhase || "",
        equipment: athlete.equipment || [],
        weeks: athlete.weeks || [],
        oneOffDays: athlete.oneOffDays || [],
        trials: athlete.trials || [],
        schedule: athlete.schedule || {},
        coachPRs: athlete.coachPRs || [],
        inviteCode: athlete.inviteCode,
        sessionBank: athlete.sessionBank || { packages: [], redemptions: [] },
        nutrition: athlete.nutrition || { current: null, history: [] },
        // The athlete's own open-slot preference, set on their own device.
        // Missing from this list until 2026-08-17, which left it undefined on
        // every rebuild — and a rebuild runs on every sign-in, every resync and
        // every realtime row event. So `if (!prog.client.hideOpenSlots)` was
        // always true and the settings toggle always drew as ON: an athlete who
        // muted open-slot alerts got them back on the next open, while their DB
        // column said otherwise. Exactly the silent disagreement the note above
        // warns about.
        hideOpenSlots: !!athlete.hideOpenSlots,
        // Same omission, same shape. partnerWarningHtml() is the only thing
        // that tells one half of a couple that cancelling takes the session off
        // their partner too, and it reads this. Undefined meant that warning
        // had never rendered for anyone.
        partnerId: athlete.partnerId || null,
        // Carried for the bookings insert. A trigger overrides it server-side,
        // so this is only ever a hint, never the authority.
        _coachId: athlete._coachId || null,
      },
    };
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.sync = Object.assign(NS.sync || {}, {
    buildProgramFromAthlete,
  });
})();
