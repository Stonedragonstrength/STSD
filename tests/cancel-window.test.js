// The notice window: how close to a session an athlete may still cancel or
// move it themselves, and when they have to ask instead.
//
// This decides whether somebody can drop a 6am session at 5:50am, so the
// boundary gets asserted from both sides. The interesting case is cancelHours
// of 0 — a real answer meaning "cancel whenever you like" — which a plain
// `|| 24` fallback would silently overrule, turning the coach's most permissive
// setting into the strictest one.
//
// DUPLICATES cancelWindowClosed() and the cancelHours clamp in
// normalizeAvailability() (app.js), which is one IIFE with no exports. The rule
// is ALSO enforced in the database by bookings_guard_update()
// (20260806200000_booking_changes.sql) — that is the authority, because a
// cached PWA still runs the old build. Change all three or this guards nothing.

const DEFAULT_CANCEL_HOURS = 24;

function normalizeCancelHours(raw) {
  return Math.max(0, Math.min(168,
    raw == null || raw === "" || isNaN(parseFloat(raw)) ? DEFAULT_CANCEL_HOURS : parseFloat(raw)));
}

function cancelWindowClosed(startMs, cancelHours, nowMs) {
  const h = normalizeCancelHours(cancelHours);
  if (!h) return false;
  return nowMs >= startMs - h * 3600000;
}

let pass = 0, fail = 0;
function eq(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}

const NOW = Date.parse("2026-08-06T12:00:00Z");
const hoursOut = (h) => NOW + h * 3600000;

console.log("normalizeCancelHours");
eq("absent falls back to 24", normalizeCancelHours(undefined), 24);
eq("null falls back to 24", normalizeCancelHours(null), 24);
eq("empty string falls back to 24", normalizeCancelHours(""), 24);
eq("rubbish falls back to 24", normalizeCancelHours("soon"), 24);
// The whole reason the clamp isn't written as `parseFloat(x) || 24`.
eq("zero is kept, not defaulted", normalizeCancelHours(0), 0);
eq("zero as a string is kept", normalizeCancelHours("0"), 0);
eq("16 is kept", normalizeCancelHours(16), 16);
eq("negative clamps to 0", normalizeCancelHours(-5), 0);
eq("over a week clamps to 168", normalizeCancelHours(500), 168);

console.log("cancelWindowClosed, 24h notice");
eq("48h out is open", cancelWindowClosed(hoursOut(48), 24, NOW), false);
eq("25h out is open", cancelWindowClosed(hoursOut(25), 24, NOW), false);
// The boundary itself is CLOSED: `now >= start - window`. A session exactly 24h
// away has had its notice used up, not one instant left of it.
eq("exactly 24h out is closed", cancelWindowClosed(hoursOut(24), 24, NOW), true);
eq("23h out is closed", cancelWindowClosed(hoursOut(23), 24, NOW), true);
eq("10 minutes out is closed", cancelWindowClosed(hoursOut(1 / 6), 24, NOW), true);
eq("already started is closed", cancelWindowClosed(hoursOut(-1), 24, NOW), true);

console.log("cancelWindowClosed, 16h notice");
eq("17h out is open", cancelWindowClosed(hoursOut(17), 16, NOW), false);
eq("exactly 16h out is closed", cancelWindowClosed(hoursOut(16), 16, NOW), true);
eq("15h out is closed", cancelWindowClosed(hoursOut(15), 16, NOW), true);

console.log("cancelWindowClosed, no notice required");
eq("0 leaves it open 10 min before", cancelWindowClosed(hoursOut(1 / 6), 0, NOW), false);
eq("0 leaves it open once started", cancelWindowClosed(hoursOut(-1), 0, NOW), false);
eq("0 as a string still opens it", cancelWindowClosed(hoursOut(1 / 6), "0", NOW), false);

console.log("cancelWindowClosed, unset availability");
// An athlete whose coach has never opened the editor gets the safe default,
// which matters because availability_for_athlete() sends cancelHours even to
// athletes who may not self-book — they can still cancel.
eq("unset behaves as 24h", cancelWindowClosed(hoursOut(23), undefined, NOW), true);
eq("unset still open at 25h", cancelWindowClosed(hoursOut(25), undefined, NOW), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
