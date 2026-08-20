// One composer per athlete-triggered notification kind.
//
// The rule these all obey: the athlete sends an id, and the sentence is
// written HERE, from data the athlete cannot edit. If a caller could pass text,
// any athlete could put anything they liked on the coach's lock screen.
//
// Two families, and the difference matters:
//
//   ROW      the event is a real table row (a message, a booking, a bug
//            report). Verify it belongs to this athlete, then read the words
//            off the row.
//
//   PROGRESS the event lives in the athlete's `progress` row, every column of
//            which the athlete overwrites wholesale on each save, so nothing
//            in it can be trusted as WORDING. Verify the fact against
//            progress, then take the words from `athletes.weeks`, the coach's
//            own copy of the program, which the athlete has no write path to.
//            "Kristyn finished Push Day" is then the coach's noun about the
//            athlete's fact.
//
// Column names here are the DATABASE's, not the app's: progress columns are
// snake_case (`day_completions`, not `dayCompletions`) because cloud.js maps
// them on the way in and out. Getting that wrong fails silently as "no such
// event" rather than as an error.

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = any;

export type Notice = { title: string; body: string; url?: string };
export type Athlete = { id: string; display_name: string | null; coach_id: string };

const nameOf = (a: Athlete) => (a.display_name || "An athlete").trim();

function when(iso: string, tz: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, weekday: "short", day: "numeric", month: "short",
      hour: "numeric", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
  }
}

/** The coach's own name for a day, looked up in their copy of the program. */
function dayNameFromProgram(weeks: Row, dayId: string): string | null {
  if (!Array.isArray(weeks)) return null;
  for (const w of weeks) {
    for (const d of (w?.days ?? [])) {
      if (d?.id === dayId) return String(d.name || "").trim() || null;
    }
  }
  return null;
}

/** Same, for a single exercise, so a PR is named by the coach's word for it. */
function exerciseNameFromProgram(weeks: Row, exId: string): string | null {
  if (!Array.isArray(weeks)) return null;
  for (const w of weeks) {
    for (const d of (w?.days ?? [])) {
      for (const e of (d?.exercises ?? [])) {
        if (e?.id === exId) return String(e.name || "").trim() || null;
      }
    }
  }
  return null;
}

/** The coach's program for this athlete. Their words, not the athlete's. */
async function weeksOf(sb: Db, athleteId: string): Promise<Row> {
  const { data } = await sb.from("athletes").select("weeks").eq("id", athleteId).maybeSingle();
  return data?.weeks ?? null;
}

/** One progress column, by its DATABASE name. */
async function progressCol(sb: Db, athleteId: string, col: string): Promise<Row> {
  const { data } = await sb.from("progress").select(col).eq("athlete_id", athleteId).maybeSingle();
  return data ? (data as Row)[col] : null;
}

async function coachTz(sb: Db, coachId: string): Promise<string> {
  const { data } = await sb.from("coaches").select("availability").eq("id", coachId).maybeSingle();
  return (data?.availability as { tz?: string } | null)?.tz || "UTC";
}

// ── Row-backed ─────────────────────────────────────────────────────────────

async function bookingRequest(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const { data: rq } = await sb.from("booking_requests")
    .select("id, kind, status, new_start_at, coach_id, bookings(start_at)")
    .eq("id", refId).eq("athlete_id", a.id).maybeSingle();
  if (!rq || rq.status !== "pending") return null;
  const tz = await coachTz(sb, rq.coach_id);
  const from = (rq.bookings as { start_at: string } | null)?.start_at;
  const body = rq.kind === "cancel"
    ? `${nameOf(a)} wants to cancel ${from ? when(from, tz) : "a session"}`
    : `${nameOf(a)} wants to move ${from ? when(from, tz) : "a session"}` +
      (rq.new_start_at ? ` to ${when(rq.new_start_at, tz)}` : "");
  return { title: "⚡ Session change request", body, url: "./" };
}

async function bookingRow(sb: Db, a: Athlete, refId: string) {
  const { data } = await sb.from("bookings")
    .select("id, start_at, coach_id, status").eq("id", refId).eq("athlete_id", a.id).maybeSingle();
  return data as Row;
}

async function bookingMade(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const b = await bookingRow(sb, a, refId);
  if (!b) return null;
  return {
    title: "📅 New booking",
    body: `${nameOf(a)} booked ${when(b.start_at, await coachTz(sb, b.coach_id))}`,
    url: "./",
  };
}

/**
 * They booked with nothing left in the bank.
 *
 * The one recipe that takes the athlete's word for something. Every other kind
 * is proved against a row, and this one cannot be: the session bank is an
 * allowance with expiry, rollover and a credit pot, computed in the browser by
 * src/money/ledger.js, and a second copy of that arithmetic here is how two
 * screens end up disagreeing about the same person's balance.
 *
 * What IS proved is the booking: it exists, it is this athlete's, and the app
 * already showed them "you have no sessions left" before they confirmed. The
 * worst a tampered client could do is tell the coach somebody is out of
 * sessions when they are not, about themselves. That is a nuisance, not a
 * hole, and it buys the coach the moment that actually costs him money.
 */
async function balanceZero(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const b = await bookingRow(sb, a, refId);
  if (!b) return null;
  return {
    title: "⚠️ Out of sessions",
    body: `${nameOf(a)} booked ${when(b.start_at, await coachTz(sb, b.coach_id))} with no sessions left`,
    url: "./",
  };
}

async function bookingCancelled(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const b = await bookingRow(sb, a, refId);
  if (!b) return null;
  return {
    title: "✕ Session cancelled",
    body: `${nameOf(a)} cancelled ${when(b.start_at, await coachTz(sb, b.coach_id))}`,
    url: "./",
  };
}

async function message(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const { data: m } = await sb.from("messages")
    .select("id, body, athlete_id, sender").eq("id", refId).maybeSingle();
  if (!m || m.athlete_id !== a.id || m.sender !== "athlete") return null; // theirs, inbound only
  // The body IS athlete-written, and that is the one case where it should be:
  // carrying their words is the entire point of a message. It is truncated and
  // the title is their name, so it can never masquerade as the app speaking.
  return { title: `💬 ${nameOf(a)}`, body: String(m.body || "").slice(0, 140), url: "./" };
}

async function bugReport(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const { data: b } = await sb.from("bug_reports")
    .select("id, athlete_id, description").eq("id", refId).maybeSingle();
  if (!b || b.athlete_id !== a.id) return null;
  return {
    title: "🐞 Problem reported",
    body: `${nameOf(a)}: ${String(b.description || "no description").slice(0, 120)}`,
    url: "./",
  };
}

function inviteClaimed(a: Athlete): Notice {
  return { title: "🤝 Athlete signed in", body: `${nameOf(a)} claimed their invite`, url: "./" };
}

// ── Progress-backed ────────────────────────────────────────────────────────
// refId is a day id, except for pr_set where it is an exercise id.

async function workoutLogged(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const done = await progressCol(sb, a.id, "day_completions");
  const stamps = done?.[refId];
  if (!Array.isArray(stamps) || !stamps.length) return null; // not actually finished
  const day = dayNameFromProgram(await weeksOf(sb, a.id), refId);
  if (!day) return null; // not a day the coach programmed: say nothing
  return { title: "💪 Session logged", body: `${nameOf(a)} finished ${day}`, url: "./" };
}

async function daySkipped(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const day = dayNameFromProgram(await weeksOf(sb, a.id), refId);
  if (!day) return null;
  return { title: "⏭ Session skipped", body: `${nameOf(a)} skipped ${day}`, url: "./" };
}

async function prSet(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const lift = exerciseNameFromProgram(await weeksOf(sb, a.id), refId);
  if (!lift) return null;
  return { title: "🥇 New PR", body: `${nameOf(a)} set a PR on ${lift}`, url: "./" };
}

async function readinessLow(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const rec = (await progressCol(sb, a.id, "readiness"))?.[refId];
  if (!rec) return null;
  const day = dayNameFromProgram(await weeksOf(sb, a.id), refId);
  return {
    title: "🔋 Rough check-in",
    body: `${nameOf(a)} is beat up before ${day || "today's session"}`,
    url: "./",
  };
}

async function sessionNote(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const note = (await progressCol(sb, a.id, "day_notes"))?.[refId];
  if (!note) return null;
  const day = dayNameFromProgram(await weeksOf(sb, a.id), refId);
  return { title: "📝 Note for you", body: `${nameOf(a)} left a note on ${day || "a session"}`, url: "./" };
}

// A form check is a clip inside progress.form_checks, keyed by DAY id, not a
// table row. Same treatment as the rest of this family.
async function formCheck(sb: Db, a: Athlete, refId: string): Promise<Notice | null> {
  const clips = (await progressCol(sb, a.id, "form_checks"))?.[refId];
  if (!Array.isArray(clips) || !clips.length) return null;
  const day = dayNameFromProgram(await weeksOf(sb, a.id), refId);
  return {
    title: "🎥 Form check",
    body: `${nameOf(a)} sent a video${day ? ` from ${day}` : ""}`,
    url: "./",
  };
}

export const RECIPES: Record<string, (sb: Db, a: Athlete, refId: string) => Promise<Notice | null>> = {
  booking_request: bookingRequest,
  booking_made: bookingMade,
  booking_cancelled: bookingCancelled,
  balance_zero: balanceZero,
  message,
  bug_report: bugReport,
  invite_claimed: (_sb, a) => Promise.resolve(inviteClaimed(a)),
  workout_logged: workoutLogged,
  day_skipped: daySkipped,
  pr_set: prSet,
  readiness_low: readinessLow,
  session_note: sessionNote,
  form_check: formCheck,
};
