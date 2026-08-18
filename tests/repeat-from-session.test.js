// Which sessions a "make this a regular" repeat actually creates.
//
// The coach reaches this from a session on the calendar, very often one that
// has ALREADY HAPPENED -- that is the case the feature was asked for.
// patternOccurrences starts from the first matching weekday on or after the
// date it is given, so handed the tapped session's own date it would happily
// book sessions into the past. Nothing would error; the coach would just find
// last Tuesday on their calendar again.
//
// The count matters as much as the dates: the sheet's button says "Book 12
// sessions" and must not then write 11. Both read this one function, and this
// test is what holds that.
//
// DUPLICATES repeatStarts + patternOccurrences + weeklyOccurrences + nextDowISO
// + dowOfISO + dateISO from app.js. Change either side and change this, or it
// guards nothing. The zone maths are the REAL ones, required from the
// extracted module (Phase 4) — no copies to keep in step anymore.

require(require("path").join(__dirname, "..", "src", "scheduling", "zone.js"));
const { tzOffsetMs, zonedTimeToUtc, zonedDateISO, zonedHM } = globalThis.STSD.scheduling;

// ---- copies from app.js ----
function dateISO(d) {
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}
function dowOfISO(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}
function nextDowISO(fromISO, dow) {
  const [y, m, d] = String(fromISO).split("-").map(Number);
  const delta = (((dow - dowOfISO(fromISO)) % 7) + 7) % 7;
  const t = new Date(Date.UTC(y, m - 1, d + delta, 12));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
function weeklyOccurrences(firstISO, hh, mm, tz, count) {
  const [y, m, d] = String(firstISO).split("-").map(Number);
  const out = [];
  for (let i = 0; i < count; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i * 7));
    out.push(zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh, mm, tz));
  }
  return out;
}
function patternOccurrences(fromISO, dows, hh, mm, tz, weeks) {
  const list = (dows || []).slice().sort((a, b) => a - b);
  const out = [];
  list.forEach((dow) => {
    out.push(...weeklyOccurrences(nextDowISO(fromISO, dow), hh, mm, tz, weeks));
  });
  return out.sort((a, b) => a - b);
}
// ---- the function under test ----
function repeatStarts(dows, hh, mm, tz, weeks, nowMs) {
  if (!(dows || []).length) return [];
  return patternOccurrences(dateISO(new Date(nowMs)), dows, hh, mm, tz, weeks)
    .filter((ms) => ms > nowMs);
}

let pass = 0, fail = 0;
function eq(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}
const TZ = "America/Los_Angeles";
const days = (list) => list.map((ms) => zonedDateISO(ms, TZ));
const times = (list) => list.map((ms) => zonedHM(ms, TZ));

console.log("-- a session that already happened repeats into the FUTURE --");
{
  // Standing on Friday 7 Aug 2026, repeating last Tuesday's 5:30pm session.
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ); // Friday evening
  const got = repeatStarts([2], 17, 30, TZ, 4, now); // 2 = Tuesday
  eq("nothing lands in the past", got.every((ms) => ms > now), true);
  eq("starts the NEXT Tuesday, not the one that passed", days(got)[0], "2026-08-11");
  eq("four Tuesdays", days(got), ["2026-08-11", "2026-08-18", "2026-08-25", "2026-09-01"]);
  eq("all at 17:30", times(got), ["17:30", "17:30", "17:30", "17:30"]);
}

console.log("\n-- a session earlier TODAY rolls to next week --");
{
  // 8pm on Friday, repeating a session that was at 10am the same morning.
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ);
  const got = repeatStarts([5], 10, 0, TZ, 3, now); // 5 = Friday
  eq("today's slot is gone, so it starts next Friday", days(got)[0], "2026-08-14");
  // "For how long" is a HORIZON in weeks, not a promise of a session count, so
  // a three-week repeat whose first slot has already been and gone is two
  // sessions. That is why the sheet's button counts from this same list rather
  // than from weeks x days -- it says "Book 2 sessions" and means it.
  eq("two sessions: today's has gone", got.length, 2);
  eq("and it ends where the three weeks end", days(got), ["2026-08-14", "2026-08-21"]);
}

console.log("\n-- a session LATER today is kept --");
{
  // 8am on Friday, repeating a 6pm Friday session: today still counts.
  const now = zonedTimeToUtc(2026, 8, 7, 8, 0, TZ);
  const got = repeatStarts([5], 18, 0, TZ, 3, now);
  eq("today is the first one", days(got)[0], "2026-08-07");
  eq("three sessions", got.length, 3);
}

console.log("\n-- several weekdays at one time stay in step --");
{
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ); // Friday evening
  const got = repeatStarts([1, 3], 6, 0, TZ, 2, now); // Mondays and Wednesdays
  eq("interleaved in date order", days(got),
    ["2026-08-10", "2026-08-12", "2026-08-17", "2026-08-19"]);
  eq("every one at 06:00", times(got), ["06:00", "06:00", "06:00", "06:00"]);
}

console.log("\n-- no days picked means nothing to book --");
{
  const now = zonedTimeToUtc(2026, 8, 7, 12, 0, TZ);
  eq("empty list", repeatStarts([], 9, 0, TZ, 12, now), []);
  eq("undefined is not a crash", repeatStarts(undefined, 9, 0, TZ, 12, now), []);
}

console.log("\n-- the clock time survives a DST boundary --");
{
  // US DST ends Sunday 1 Nov 2026. A Monday 6am series crossing it must stay
  // 6am; a naive +7*86400000ms would drift it to 5am.
  const now = zonedTimeToUtc(2026, 10, 20, 12, 0, TZ);
  const got = repeatStarts([1], 6, 0, TZ, 4, now);
  eq("still 6am on both sides of the change", times(got), ["06:00", "06:00", "06:00", "06:00"]);
  eq("consecutive Mondays across the boundary", days(got),
    ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
}

console.log("\n-- the count the button promises is the count that gets written --");
{
  // The sheet labels its button from this list and the write maps over the same
  // list. Anything that makes them disagree is a bug in one of the two callers.
  const now = zonedTimeToUtc(2026, 8, 7, 20, 0, TZ);
  [1, 4, 12].forEach((weeks) => {
    const got = repeatStarts([2, 4], 17, 30, TZ, weeks, now);
    eq(`${weeks} weeks x 2 days = ${weeks * 2} rows`, got.length, weeks * 2);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
