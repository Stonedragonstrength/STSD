// Every kind of notification the coach can receive, and what each one defaults
// to. This is the canonical list. See
// docs/superpowers/specs/2026-08-19-coach-push-notifications-design.md.
//
// Loaded as a classic script like the src/training modules, so instead of
// `export` it assigns onto the STSD namespace.
//
// The Edge Functions cannot import this file (Deno, different runtime), so
// supabase/functions/_shared/coach-notify.ts keeps its own DEFAULT_MODES copy
// of the id-to-default mapping. src/notify/coach-kinds.spec.js reads that file
// as text and fails if the two ever disagree, which is the only thing standing
// between a new category here and a server that silently mutes it.
(function () {
  "use strict";

  // Three modes, not two. An athlete has one coach, so a category is either
  // wanted or not; a coach has a roster, and twenty-eight athletes logging
  // workouts is fifteen to twenty pushes a day. Anything routine therefore
  // defaults to `digest` so the feature survives its first week.
  const MODES = ["off", "instant", "digest"];

  const GROUPS = [
    { id: "training", label: "Training activity",
      blurb: "What the roster is actually doing. The loud group, so most of it lands in the daily summary." },
    { id: "talking", label: "Talking to you",
      blurb: "Rare, and every one is something you would want to answer." },
    { id: "schedule", label: "Schedule",
      blurb: "Anything that moves a session, and anything that stops one being booked." },
    { id: "money", label: "Money",
      blurb: "Square is live, so a failed charge is the one here that should reach your phone straight away." },
  ];

  // `source` records how the event is proved, which decides where its recipe
  // lives and what it is allowed to say:
  //   row      a real table verifies it; the text is read off that row
  //   progress verified against the athlete's progress blob, but WORDED from
  //            the coach's own copy of their program, which they cannot write
  //   server   nothing to verify: a webhook or a cron raised it
  const COACH_KINDS = [
    { id: "workout_logged", group: "training", source: "progress", def: "digest",
      label: "Workout logged", hint: "An athlete finished a day you programmed." },
    { id: "pr_set", group: "training", source: "progress", def: "digest",
      label: "New PR", hint: "Someone beat a personal record." },
    { id: "day_skipped", group: "training", source: "progress", def: "digest",
      label: "Day skipped", hint: "A session marked skipped. Two in a row is called out." },
    { id: "readiness_low", group: "training", source: "progress", def: "instant",
      label: "Rough check-in", hint: "They checked in beat up before a session today. Instant by default: it is only useful before the session it describes." },
    { id: "session_note", group: "training", source: "progress", def: "digest",
      label: "Note left for you", hint: "An athlete wrote you a note on a session." },
    { id: "athlete_quiet", group: "training", source: "server", def: "digest",
      label: "Gone quiet", hint: "No activity from someone for a week." },

    { id: "message", group: "talking", source: "row", def: "instant",
      label: "Message", hint: "An athlete messaged you." },
    { id: "form_check", group: "talking", source: "row", def: "instant",
      label: "Form check sent", hint: "A video is waiting for your review." },
    { id: "invite_claimed", group: "talking", source: "row", def: "instant",
      label: "Invite claimed", hint: "A new athlete signed in for the first time." },
    { id: "bug_report", group: "talking", source: "row", def: "instant",
      label: "Problem reported", hint: "Someone filed a bug from inside the app." },

    { id: "booking_request", group: "schedule", source: "row", def: "instant",
      label: "Booking request", hint: "Someone asked to book, move or cancel. This is the one you already get." },
    { id: "booking_made", group: "schedule", source: "row", def: "instant",
      label: "Booked themselves in", hint: "An athlete took one of your open slots." },
    { id: "booking_cancelled", group: "schedule", source: "row", def: "instant",
      label: "Cancelled", hint: "An athlete cancelled a session they held." },
    { id: "balance_zero", group: "schedule", source: "server", def: "instant",
      label: "Out of sessions", hint: "Someone's balance hit zero, so they cannot book again." },

    { id: "payment_in", group: "money", source: "server", def: "digest",
      label: "Payment landed", hint: "A card payment cleared." },
    { id: "charge_failed", group: "money", source: "server", def: "instant",
      label: "Charge failed", hint: "A card was declined. Real money did not move." },
    { id: "month_uncollected", group: "money", source: "server", def: "digest",
      label: "Still uncollected", hint: "Sessions granted this month that nobody has paid for yet." },
  ];

  const COACH_KIND_BY_ID = Object.fromEntries(COACH_KINDS.map((k) => [k.id, k]));
  const DEFAULT_COACH_MODES = Object.fromEntries(COACH_KINDS.map((k) => [k.id, k.def]));

  /** The mode for one kind, falling back to its default. Unknown kind = off. */
  function coachModeFor(modes, kind) {
    const k = COACH_KIND_BY_ID[kind];
    if (!k) return "off";
    const v = modes && modes[kind];
    return MODES.includes(v) ? v : k.def;
  }

  globalThis.STSD = globalThis.STSD || {};
  globalThis.STSD.notify = Object.assign(globalThis.STSD.notify || {}, {
    MODES, GROUPS, COACH_KINDS, COACH_KIND_BY_ID, DEFAULT_COACH_MODES, coachModeFor,
  });
})();
