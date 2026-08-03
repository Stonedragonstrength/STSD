// Who gets told about a booked session, and when. This decides whether a real
// person's phone buzzes, so every boundary gets an assertion — a reminder that
// arrives after the session is worse than none, and one that arrives twice is
// worse than that.
//
// DUPLICATES the filter in supabase/functions/session-reminder/index.ts (Deno,
// no shared module with Node here). Change both or this guards nothing.

const MAX_LEAD_MIN = 24 * 60;

// `rows` is what the query already narrowed to: status booked, not yet
// reminded, starting between now and now + MAX_LEAD. Both halves are asserted
// below so the query's job is covered too.
function dueBookings(rows, prefsById, nowMs) {
  return rows
    .filter((b) => b.status === "booked")
    .filter((b) => !b.reminder_sent_at)
    .filter((b) => {
      const startMs = Date.parse(b.start_at);
      return startMs >= nowMs && startMs <= nowMs + MAX_LEAD_MIN * 60000;
    })
    .filter((b) => {
      const p = prefsById[b.athlete_id];
      if (p && p.notify_sessions === false) return false;
      const lead = Math.min(MAX_LEAD_MIN, Math.max(5, (p && p.session_lead_mins) ?? 120));
      const startMs = Date.parse(b.start_at);
      if (!Number.isFinite(startMs)) return false;
      return nowMs >= startMs - lead * 60000;
    });
}

let pass = 0, fail = 0;
function eq(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}

const NOW = Date.parse("2026-08-03T14:00:00Z");
const at = (mins) => new Date(NOW + mins * 60000).toISOString();
const bk = (id, athlete, mins, extra = {}) =>
  ({ id, athlete_id: athlete, start_at: at(mins), status: "booked", reminder_sent_at: null, ...extra });
const ids = (list) => list.map((b) => b.id);

console.log("-- the default two-hour lead --");
{
  const prefs = {};
  eq("three hours out: too early", ids(dueBookings([bk("b", "a", 180)], prefs, NOW)), []);
  eq("exactly two hours out: due", ids(dueBookings([bk("b", "a", 120)], prefs, NOW)), ["b"]);
  eq("one hour out: still due, not skipped", ids(dueBookings([bk("b", "a", 60)], prefs, NOW)), ["b"]);
  eq("five minutes out: due", ids(dueBookings([bk("b", "a", 5)], prefs, NOW)), ["b"]);
}

console.log("\n-- a reminder is never sent after the session starts --");
{
  eq("one minute past: gone", ids(dueBookings([bk("b", "a", -1)], {}, NOW)), []);
  eq("an hour past: gone", ids(dueBookings([bk("b", "a", -60)], {}, NOW)), []);
}

console.log("\n-- one push per booking, ever --");
{
  const already = bk("b", "a", 60, { reminder_sent_at: "2026-08-03T13:00:00Z" });
  eq("already stamped: never again", ids(dueBookings([already], {}, NOW)), []);
}

console.log("\n-- the athlete's own switch --");
{
  const off = { a: { notify_sessions: false, session_lead_mins: 120 } };
  eq("turned off: silent", ids(dueBookings([bk("b", "a", 60)], off, NOW)), []);
  const on = { a: { notify_sessions: true, session_lead_mins: 120 } };
  eq("turned on: due", ids(dueBookings([bk("b", "a", 60)], on, NOW)), ["b"]);
}

console.log("\n-- an athlete who never opened Profile has no prefs row --");
{
  eq("missing row falls back to two hours, and is ON", ids(dueBookings([bk("b", "a", 90)], {}, NOW)), ["b"]);
  eq("missing row still respects the lead", ids(dueBookings([bk("b", "a", 200)], {}, NOW)), []);
}

console.log("\n-- a custom lead --");
{
  const half = { a: { notify_sessions: true, session_lead_mins: 30 } };
  eq("30-minute lead: an hour out is too early", ids(dueBookings([bk("b", "a", 60)], half, NOW)), []);
  eq("30-minute lead: 25 minutes out is due", ids(dueBookings([bk("b", "a", 25)], half, NOW)), ["b"]);
  const morning = { a: { notify_sessions: true, session_lead_mins: 720 } };
  eq("morning-of lead: 10 hours out is due", ids(dueBookings([bk("b", "a", 600)], morning, NOW)), ["b"]);
}

console.log("\n-- a nonsense lead can't break the send --");
{
  const zero = { a: { notify_sessions: true, session_lead_mins: 0 } };
  eq("floored at 5 min: 10 out is too early", ids(dueBookings([bk("b", "a", 10)], zero, NOW)), []);
  eq("floored at 5 min: 4 out is due", ids(dueBookings([bk("b", "a", 4)], zero, NOW)), ["b"]);
  const huge = { a: { notify_sessions: true, session_lead_mins: 999999 } };
  eq("capped at 24h: a session 23h out is due", ids(dueBookings([bk("b", "a", 23 * 60)], huge, NOW)), ["b"]);
  eq("capped at 24h: 25h out is beyond the query anyway",
    ids(dueBookings([bk("b", "a", 25 * 60)], huge, NOW)), []);
}

console.log("\n-- two sessions in one day are two reminders --");
{
  const rows = [bk("morning", "a", 30), bk("evening", "a", 480)];
  eq("only the near one is due now", ids(dueBookings(rows, {}, NOW)), ["morning"]);
  const later = NOW + 400 * 60000;
  eq("the evening one comes due on its own", ids(dueBookings(rows, {}, later)), ["evening"]);
}

console.log("\n-- a cancelled session says nothing --");
{
  eq("cancelled is skipped", ids(dueBookings([bk("b", "a", 60, { status: "cancelled" })], {}, NOW)), []);
}

console.log("\n-- a missed cron tick sends late rather than never --");
{
  // The window is "from lead-before until the start", not a 15-minute slice,
  // so a run that never happened at the 2h mark still catches this at 20 min.
  eq("still due 20 minutes out on a 2h lead", ids(dueBookings([bk("b", "a", 20)], {}, NOW)), ["b"]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
