// What the income card is allowed to count, and what it is actually given.
//
// This is a test about TWO windows agreeing. `refreshCoachSchedule` fetches a
// range of bookings; `incomeForecast` then sums a period out of whatever it got.
// Nothing connects them in the code, so when the fetch window was `now - 24h`
// the sum silently answered a different question than its own label: "This week"
// meant "since yesterday". On Friday 7 Aug 2026 the roster had 28 booked
// sessions in the week and the card read 8 — the six on Friday, one on Saturday,
// and the single Thursday evening slot that happened to fall inside 24 hours.
//
// Nothing about that looks wrong on screen. It is a plausible number in the
// right font, so it earns a test rather than a look.
//
// DUPLICATES the window in app.js `refreshCoachSchedule` and the summing in
// `incomeForecast`. Change either original and change the copy here too.

// ---- copy of the fetch window (app.js refreshCoachSchedule) ----
function fetchFrom(now) {
  const backTo = new Date(now);
  backTo.setHours(0, 0, 0, 0);
  const monthStart = new Date(backTo); monthStart.setDate(1);
  const weekStart = new Date(backTo); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  return new Date(Math.min(+monthStart, +weekStart));
}
// The window this replaced, kept so the regression itself is asserted and not
// just the fix.
const oldFetchFrom = (now) => new Date(+now - 86400000);

// ---- copy of the summing (app.js incomeForecast) ----
const dateISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function weekStartOf(iso) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - d.getDay());
  return dateISO(d);
}
function addDaysISO(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return dateISO(d);
}
// `rows` is what the fetch actually returned, so a booking outside the fetch
// window cannot be counted here — which is the whole point.
function incomeForecast(rows, now) {
  const today = dateISO(new Date(now));
  const wkStart = weekStartOf(today);
  const wkEnd = addDaysISO(wkStart, 7);
  const fourEnd = addDaysISO(wkStart, 28);
  let sessions = 0, fourSessions = 0;
  rows.forEach((b) => {
    if (b.status !== "booked") return;
    const d = dateISO(new Date(b.start_at));
    if (d < wkStart || d >= fourEnd) return;
    fourSessions++;
    if (d < wkEnd) sessions++;
  });
  return { sessions, fourSessions };
}

let pass = 0, fail = 0;
function eq(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}

// Local time throughout: the card reads dates off the browser's clock, so the
// boundary that matters is local midnight, not UTC.
const local = (y, m, d, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm);
const bk = (d, hh) => ({ status: "booked", start_at: local(2026, 8, d, hh).toISOString() });
// Serve rows the way the query does — only what falls inside the fetch window.
const served = (rows, from, now) => rows.filter((b) => +new Date(b.start_at) >= +from && +new Date(b.start_at) <= +now + 400 * 86400000);

console.log("-- the week Nathan reported: Fri 7 Aug 2026, 28 booked sessions --");
{
  // The real shape from production: Mon 5, Tue 5, Wed 6, Thu 5, Fri 6, Sat 1.
  const week = [
    ...[9, 10, 11, 16, 19].map((h) => bk(3, h)),
    ...[9, 10, 11, 16, 19].map((h) => bk(4, h)),
    ...[9, 10, 11, 15, 16, 19].map((h) => bk(5, h)),
    ...[10, 11, 16, 19, 20].map((h) => bk(6, h)),
    ...[10, 11, 12, 15, 18, 19].map((h) => bk(7, h)),
    bk(8, 13),
  ];
  eq("the week really is 28 sessions", week.length, 28);

  const now = local(2026, 8, 7, 20, 0); // Friday evening, when he looked
  eq("all 28 are counted", incomeForecast(served(week, fetchFrom(now), now), now).sessions, 28);
  eq("the old 24h window is what read 8", incomeForecast(served(week, oldFetchFrom(now), now), now).sessions, 8);
}

console.log("\n-- the window reaches the start of the week on every day of it --");
{
  const week = [3, 4, 5, 6, 7, 8].map((d) => bk(d, 10)); // Mon..Sat, one each
  // Sunday 2 Aug is the week start; by Saturday it is six days behind.
  for (let d = 2; d <= 8; d++) {
    const now = local(2026, 8, d, 23, 30);
    const got = incomeForecast(served(week, fetchFrom(now), now), now).sessions;
    const want = week.filter((b) => +new Date(b.start_at) >= +local(2026, 8, 2)).length;
    eq(`standing on 8-0${d}, the whole week is in reach`, got, want);
  }
}

console.log("\n-- 'Next 4 weeks' is anchored to the same Sunday, so it lost the same days --");
{
  const rows = [bk(3, 10), bk(4, 10), bk(20, 10), bk(26, 10)];
  const now = local(2026, 8, 7, 20, 0);
  eq("four-week count keeps the elapsed days", incomeForecast(served(rows, fetchFrom(now), now), now).fourSessions, 4);
  eq("the old window dropped them", incomeForecast(served(rows, oldFetchFrom(now), now), now).fourSessions, 2);
}

console.log("\n-- month start vs week start: whichever is EARLIER wins --");
{
  // Wed 1 Jul 2026 — the month starts mid-week, so the week start (Sun 28 Jun)
  // is in the previous month and is the earlier of the two.
  const now = local(2026, 7, 1, 12, 0);
  eq("a week spanning the month boundary reaches back into June",
    +fetchFrom(now), +local(2026, 6, 28));

  // Sat 31 Jan 2026 — the week started Sun 25 Jan, but the books fold counts
  // whole months, so the 1st is the earlier anchor.
  const jan = local(2026, 1, 31, 12, 0);
  eq("late in a month, the window reaches the 1st", +fetchFrom(jan), +local(2026, 1, 1));

  // Sunday IS the week start: no reaching back past today for the week, but the
  // month still pulls it to the 1st.
  const sun = local(2026, 8, 16, 8, 0);
  eq("on a Sunday mid-month, the month anchor still applies", +fetchFrom(sun), +local(2026, 8, 1));
}

console.log("\n-- the window never reaches forward of what it must cover --");
{
  // The invariant the bug violated, stated directly: for any day of any month,
  // the fetch must start at or before the period the card sums.
  let worst = 0;
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= 28; d++) {
      const now = local(2026, m, d, 12, 0);
      const wk = new Date(weekStartOf(dateISO(now)) + "T00:00:00");
      const mo = local(2026, m, 1);
      const from = fetchFrom(now);
      if (+from > +wk || +from > +mo) worst++;
    }
  }
  eq("no day of the year starts the fetch after its own week or month", worst, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
