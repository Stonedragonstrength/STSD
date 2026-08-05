// The 🎁 countdown on a coach roster card. Worth pinning down because every
// interesting case is a boundary nobody hits while developing: the chip is
// invisible 360 days a year, so a year-end or leap-day mistake would sit there
// until someone's birthday quietly failed to show.
//
// DUPLICATES birthdayThisYear() / nextBirthdayISO() / daysUntilBirthday() from
// app.js (one IIFE, nothing exported). Change both or this guards nothing.

const BIRTHDAY_CHIP_DAYS = 5;

function dateISO(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function birthdayThisYear(iso, year) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return "";
  const [, mm, dd] = iso.split("-").map(Number);
  const y = year || new Date().getFullYear();
  return dateISO(new Date(y, mm - 1, dd));
}
function nextBirthdayISO(iso, fromISO) {
  const today = fromISO;
  const y = Number(today.slice(0, 4));
  for (const year of [y, y + 1]) {
    const due = birthdayThisYear(iso, year);
    if (due && due >= today) return due;
  }
  return "";
}
function daysUntilBirthday(iso, fromISO) {
  const due = nextBirthdayISO(iso, fromISO);
  if (!due) return null;
  return Math.round(
    (new Date(due + "T12:00:00") - new Date(fromISO + "T12:00:00")) / 86400000);
}
const shows = (iso, from) => {
  const d = daysUntilBirthday(iso, from);
  return d !== null && d <= BIRTHDAY_CHIP_DAYS;
};

let pass = 0, fail = 0;
function eq(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}

// ---- the ordinary countdown ----
eq("5 days out is the last day it shows", daysUntilBirthday("1990-08-09", "2026-08-04"), 5);
eq("...and it does show", shows("1990-08-09", "2026-08-04"), true);
eq("6 days out is one too many", daysUntilBirthday("1990-08-10", "2026-08-04"), 6);
eq("...and stays hidden", shows("1990-08-10", "2026-08-04"), false);
eq("tomorrow", daysUntilBirthday("1990-08-05", "2026-08-04"), 1);
eq("the day itself is 0, not 365", daysUntilBirthday("1990-08-04", "2026-08-04"), 0);

// ---- the day after ----
// The whole reason nextBirthdayISO tries two years: this year's occurrence is
// now in the past, so the answer must roll to next year rather than go negative.
eq("day after rolls to next year", daysUntilBirthday("1990-08-03", "2026-08-04"), 364);
eq("...and the chip is gone", shows("1990-08-03", "2026-08-04"), false);

// ---- across New Year, in both directions ----
eq("Jan 2 seen from Dec 30", daysUntilBirthday("1995-01-02", "2026-12-30"), 3);
eq("...shows", shows("1995-01-02", "2026-12-30"), true);
eq("Jan 1 seen from Dec 31", daysUntilBirthday("1995-01-01", "2026-12-31"), 1);
eq("Dec 31 seen from Dec 28", daysUntilBirthday("1995-12-31", "2026-12-28"), 3);
eq("Jan 8 seen from Dec 30 is out of range", shows("1995-01-08", "2026-12-30"), false);

// ---- leap day ----
// Feb 29 lands on Mar 1 in a common year — the convention birthdayThisYear
// already picked, asserted here so the gift can't silently move to Feb 28.
eq("Feb 29 in a common year lands Mar 1", birthdayThisYear("1996-02-29", 2027), "2027-03-01");
eq("Feb 29 in a leap year stays put", birthdayThisYear("1996-02-29", 2028), "2028-02-29");
eq("counted from Feb 25 of a common year", daysUntilBirthday("1996-02-29", "2027-02-25"), 4);
eq("counted from Feb 25 of a leap year", daysUntilBirthday("1996-02-29", "2028-02-25"), 4);

// ---- no birthday on file ----
eq("blank is null", daysUntilBirthday("", "2026-08-04"), null);
eq("undefined is null", daysUntilBirthday(undefined, "2026-08-04"), null);
eq("a half-typed date is null", daysUntilBirthday("1990-08", "2026-08-04"), null);
eq("junk is null", daysUntilBirthday("not a date", "2026-08-04"), null);
eq("no birthday never shows a chip", shows("", "2026-08-04"), false);

// ---- DST: the count is in local calendar days, not 24h blocks ----
// US DST forward is Mar 8 2026; a naive ms/86400000 with floor() reads 4.96
// days as 4. Round() over noon-anchored dates keeps it honest.
eq("spans a DST forward jump", daysUntilBirthday("1990-03-11", "2026-03-06"), 5);
eq("spans a DST back jump", daysUntilBirthday("1990-11-03", "2026-10-30"), 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
