/**
 * The two coach notifications nothing raises: they are TRUE of the data rather
 * than caused by an event.
 *
 * Every other kind hangs off something that happened. An athlete finished a
 * day, Square took a card, a booking moved. "Gone quiet" and "still
 * uncollected" have no such moment. Nobody does anything, which is the point,
 * so the digest cron works them out on its own once a day.
 *
 * All of it is pure so it can be tested with fixtures rather than a roster:
 * see tests/coach-derived.spec.js. coach-digest does the IO around it.
 */

/** No session logged in this many days is "gone quiet". */
export const QUIET_DAYS = 7;

/**
 * The day of the month from which unpaid grants are worth mentioning.
 *
 * Sessions are billed in advance, so on the 1st every grant for the new month
 * is unpaid and saying so would be noise on the one day it means nothing. By
 * the 5th an unpaid month is genuinely outstanding.
 */
export const UNCOLLECTED_FROM_DAY = 5;

export type Athlete = { id: string; name: string };
export type QuietRow = Athlete & { dayCompletions: unknown };
export type BankRow = Athlete & { bank: unknown };

/** Whole days between two YYYY-MM-DD strings, ignoring clocks entirely. */
export function daysBetween(fromISO: string, toISO: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromISO) || !/^\d{4}-\d{2}-\d{2}$/.test(toISO)) return null;
  const a = Date.parse(fromISO + "T00:00:00Z");
  const b = Date.parse(toISO + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * The date of the athlete's most recent finished day, or null.
 *
 * `day_completions` is { dayId: ["YYYY-MM-DD"] } and the date inside is the
 * date TRAINED, not the date recorded, which is what makes it the right clock:
 * a session filled in three days late still counts as trained when it was.
 * An empty array is a day that was un-ticked and means nothing was trained.
 */
export function lastLoggedOn(dayCompletions: unknown): string | null {
  if (!dayCompletions || typeof dayCompletions !== "object") return null;
  let best: string | null = null;
  for (const v of Object.values(dayCompletions as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    for (const d of v) {
      const s = typeof d === "string" ? d.slice(0, 10) : "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(s) && (!best || s > best)) best = s;
    }
  }
  return best;
}

/**
 * The athletes who go quiet TODAY, not the ones who are quiet.
 *
 * The difference is the whole design. "Last logged 7 or more days ago" is true
 * of the same people every day forever, so a digest kind built on it would
 * repeat the same names until the coach switched the category off. Crossing
 * the line is an event, and it happens once.
 *
 * The cost is that a day the cron does not run is a day of crossings nobody
 * hears about. That is the right trade for a category whose failure mode is
 * being ignored.
 *
 * An athlete who has never logged anything is not included: there is no line
 * for them to cross, and a roster is full of people who joined and never
 * started.
 */
export function quietCrossers(rows: QuietRow[], todayISO: string, days = QUIET_DAYS): Athlete[] {
  const out: Athlete[] = [];
  for (const r of rows) {
    const last = lastLoggedOn(r.dayCompletions);
    if (!last) continue;
    if (daysBetween(last, todayISO) === days) out.push({ id: r.id, name: r.name });
  }
  return out;
}

// Copied from src/money/ledger.js. Deliberately only the two one-line
// questions, NOT the balance arithmetic beside them: this asks which month a
// package is for and whether it is flagged unpaid. Working out what an athlete
// has LEFT is bankLedger's job, and a second copy of that is how two screens
// end up disagreeing about the same person.
function pkgMonth(p: Record<string, unknown>): string {
  return String(p?.membershipGrant || p?.autoRenewGrant || "");
}
function pkgOwed(p: Record<string, unknown>): boolean {
  return !!p && (!!p.unpaid || p.status === "pending");
}

/** Only worth saying once the month is genuinely late. See the constant. */
export function uncollectedIsDue(todayISO: string, fromDay = UNCOLLECTED_FROM_DAY): boolean {
  const day = Number(todayISO.slice(8, 10));
  return Number.isFinite(day) && day >= fromDay;
}

/**
 * Athletes whose grant for THIS month is still marked unpaid, with how many
 * sessions that grant was worth.
 *
 * `unpaid` is the coach's own note to himself: money moves outside the app for
 * everyone not on a card, so nothing else can know. A package bought outright
 * carries no month and is not part of a month's collection.
 */
export function uncollectedThisMonth(
  rows: BankRow[], monthKey: string,
): { id: string; name: string; sessions: number }[] {
  const out: { id: string; name: string; sessions: number }[] = [];
  for (const r of rows) {
    const packages = (r.bank as { packages?: unknown[] } | null)?.packages;
    if (!Array.isArray(packages)) continue;
    let sessions = 0;
    for (const p of packages as Record<string, unknown>[]) {
      if (pkgMonth(p) !== monthKey || !pkgOwed(p)) continue;
      sessions += Number(p.size) || 0;
    }
    if (sessions > 0) out.push({ id: r.id, name: r.name, sessions });
  }
  return out;
}

/** "Kristyn, Dan and 2 more" - a body has to fit on a lock screen. */
export function nameList(names: string[], max = 3): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const head = shown.length > 1
    ? shown.slice(0, -1).join(", ") + " and " + shown[shown.length - 1]
    : (shown[0] ?? "");
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : head;
}
