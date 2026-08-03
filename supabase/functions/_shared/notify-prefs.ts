// Shared notification-preference helpers for the push functions.
//
// One athlete row in `athlete_prefs` decides three things: whether they want a
// given category of push at all, whether right now is inside their quiet
// hours, and what "today" means where they live. Missing row = defaults on,
// so an athlete who never opened Profile still hears from their coach.

export type Prefs = {
  athlete_id: string;
  notify_bulletins: boolean;
  notify_messages: boolean;
  notify_formchecks: boolean;
  // A booked session is coming up. Its own switch, not a coach-sent category:
  // session-reminder reads it directly and ignores quiet hours.
  notify_sessions: boolean;
  session_lead_mins: number;
  reminder_on: boolean;
  reminder_time: string;
  tz: string;
  quiet_on: boolean;
  quiet_from: string;
  quiet_to: string;
  last_reminder_on: string | null;
};

export type PushKind = "bulletin" | "message" | "formcheck" | "reminder";

const KIND_COLUMN: Record<PushKind, keyof Prefs | null> = {
  bulletin: "notify_bulletins",
  message: "notify_messages",
  formcheck: "notify_formchecks",
  reminder: null, // the reminder has its own on/off switch
};

/** Minutes past local midnight, or null if the string isn't "HH:MM". */
export function minutesOfDay(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** The athlete's own wall clock right now: { date: "YYYY-MM-DD", minutes }. */
export function localNow(tz: string, at = new Date()): { date: string; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || "UTC",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(at);
  } catch {
    return localNow("UTC", at); // bad tz string: fall back rather than throw
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour"); // en-CA can emit 24:00
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(hour) * 60 + Number(get("minute")),
  };
}

/** True when the athlete's local time sits inside their quiet window. */
export function inQuietHours(p: Prefs, at = new Date()): boolean {
  if (!p.quiet_on) return false;
  const from = minutesOfDay(p.quiet_from), to = minutesOfDay(p.quiet_to);
  if (from == null || to == null || from === to) return false;
  const now = localNow(p.tz, at).minutes;
  // A window like 21:00→07:00 wraps past midnight, so it's two ranges.
  return from < to ? (now >= from && now < to) : (now >= from || now < to);
}

/**
 * Filters athlete ids down to the ones who should receive this push.
 * Coach-sent kinds respect both the category switch and quiet hours.
 */
export function allowedTargets(ids: string[], prefs: Prefs[], kind: PushKind, at = new Date()): string[] {
  const col = KIND_COLUMN[kind];
  const byId = new Map(prefs.map((p) => [p.athlete_id, p]));
  return ids.filter((id) => {
    const p = byId.get(id);
    if (!p) return true; // no row yet: defaults are all-on
    if (col && p[col] === false) return false;
    return !inQuietHours(p, at);
  });
}
