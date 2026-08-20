// The coach's daily summary, and the catch-up for anything quiet hours held
// back. Runs every 15 minutes on pg_cron.
//
// Three jobs in one pass, which is why it cannot simply run once a day at the
// digest hour:
//
//   0. SWEEP. Two categories are true of the roster rather than raised by
//      anything: nobody DOES "gone quiet" or "still uncollected". They are
//      worked out here, once per coach per local day, before the queue below
//      is read so they can ride the same summary.
//
//   1. FLUSH. An `instant` notification that arrived inside quiet hours was
//      queued with deferred = true rather than dropped. The moment the coach
//      is out of quiet hours it goes out. Dropping is what the athlete side
//      does; a coach losing a failed card charge overnight costs money.
//
//   2. DIGEST. Once the coach's own wall clock passes their digest time, every
//      other queued row collapses into one push and last_digest_on is stamped,
//      so a 15-minute cron can never send the same summary twice in a day.
//
// Queue rows are deleted as they are sent. Nothing here is a record.
//
// See docs/superpowers/specs/2026-08-19-coach-push-notifications-design.md.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";
import { localNow } from "../_shared/notify-prefs.ts";
import { vapidDetails } from "../_shared/webpush.ts";
import {
  coachIsQuiet, dailyTaskDue, deliverToCoach, digestIsDue, pushToCoachNow, type CoachPrefs,
} from "../_shared/coach-notify.ts";
import {
  QUIET_DAYS, nameList, quietCrossers, uncollectedIsDue, uncollectedThisMonth,
} from "../_shared/coach-derived.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
type Row = any;

// How the digest reads. Order is the order a coach would want to be told:
// money first because it is actionable, then people waiting on them, then what
// the roster did.
const KIND_ORDER = [
  "charge_failed", "payment_in", "month_uncollected",
  "booking_request", "booking_made", "booking_cancelled", "balance_zero",
  "message", "form_check", "bug_report", "invite_claimed",
  "readiness_low", "session_note", "pr_set", "day_skipped", "workout_logged", "athlete_quiet",
];

const NOUN: Record<string, [string, string]> = {
  workout_logged: ["session logged", "sessions logged"],
  pr_set: ["PR", "PRs"],
  day_skipped: ["skip", "skips"],
  readiness_low: ["rough check-in", "rough check-ins"],
  session_note: ["note", "notes"],
  athlete_quiet: ["athlete gone quiet", "athletes gone quiet"],
  message: ["message", "messages"],
  form_check: ["form check", "form checks"],
  invite_claimed: ["athlete signed in", "athletes signed in"],
  bug_report: ["problem reported", "problems reported"],
  booking_request: ["change request", "change requests"],
  booking_made: ["new booking", "new bookings"],
  booking_cancelled: ["cancellation", "cancellations"],
  balance_zero: ["athlete out of sessions", "athletes out of sessions"],
  payment_in: ["payment", "payments"],
  charge_failed: ["FAILED charge", "FAILED charges"],
  month_uncollected: ["month still uncollected", "months still uncollected"],
};

/**
 * One line per kind, counted. A single item of a kind keeps its own sentence,
 * because "1 message" is worse than the message.
 */
export function digestBody(rows: Row[]): string {
  const byKind = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byKind.has(r.kind)) byKind.set(r.kind, []);
    byKind.get(r.kind)!.push(r);
  }
  const parts: string[] = [];
  for (const kind of KIND_ORDER) {
    const hits = byKind.get(kind);
    if (!hits?.length) continue;
    if (hits.length === 1) { parts.push(hits[0].body); continue; }
    const noun = NOUN[kind] ?? [kind, kind];
    parts.push(`${hits.length} ${noun[1]}`);
  }
  // Anything with a kind this function has never heard of still gets said,
  // rather than vanishing because a category was added and this list was not.
  for (const [kind, hits] of byKind) {
    if (KIND_ORDER.includes(kind)) continue;
    parts.push(hits.length === 1 ? hits[0].body : `${hits.length} ${kind}`);
  }
  return parts.join(" · ");
}

/**
 * The kinds nothing raises: true of the roster rather than caused by an event.
 *
 * Runs once per coach per local day, on the same clock as their digest and
 * BEFORE the queue is read, so anything it finds rides today's summary instead
 * of tomorrow's. Everything goes through deliverToCoach, so a coach who has
 * these on instant gets them at their digest time and one who has them off
 * gets nothing.
 *
 * The rules themselves are pure and live in _shared/coach-derived.ts, with
 * fixtures in tests/coach-derived.spec.js. This function is only the IO.
 */
async function sweepDerived(sb: Row, prefs: CoachPrefs, at: Date) {
  const today = localNow(prefs.tz, at).date;
  const { data: roster } = await sb
    .from("athletes").select("id, display_name, session_bank").eq("coach_id", prefs.coach_id);
  if (!roster?.length) return;

  const named = (id: string, fallback = "An athlete") =>
    roster.find((a: Row) => a.id === id)?.display_name || fallback;

  // ---- Gone quiet ----
  const { data: prog } = await sb
    .from("progress").select("athlete_id, day_completions")
    .in("athlete_id", roster.map((a: Row) => a.id));
  const crossed = quietCrossers(
    (prog ?? []).map((p: Row) => ({
      id: p.athlete_id, name: named(p.athlete_id), dayCompletions: p.day_completions,
    })),
    today,
  );
  for (const a of crossed) {
    await deliverToCoach(sb, prefs.coach_id, "athlete_quiet", {
      title: "🌙 Gone quiet",
      body: `${a.name} has not logged a session in ${QUIET_DAYS} days`,
      url: "./",
    }, at);
  }

  // ---- Still uncollected ----
  if (!uncollectedIsDue(today)) return;
  const owed = uncollectedThisMonth(
    roster.map((a: Row) => ({ id: a.id, name: named(a.id), bank: a.session_bank })),
    today.slice(0, 7),
  );
  if (!owed.length) return;
  const sessions = owed.reduce((n, r) => n + r.sessions, 0);
  await deliverToCoach(sb, prefs.coach_id, "month_uncollected", {
    title: "💸 Still uncollected",
    body: `${sessions} session${sessions === 1 ? "" : "s"} granted this month are unpaid: ${
      nameList(owed.map((r) => r.name))}`,
    url: "./",
  }, at);
}

Deno.serve(async (req) => {
  if (!isServiceRoleCaller(req.headers.get("Authorization"))) {
    return json({ error: "forbidden" }, 403);
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!vapidDetails()) return json({ error: "VAPID keys not configured" }, 500);
    const sb = createClient(supabaseUrl, serviceKey);
    const at = new Date();

    // The derived kinds come first, and outside the queue check below: they
    // are what PUTS things in the queue, so a coach whose queue is empty is
    // exactly the coach who still needs sweeping.
    let swept = 0;
    const { data: allPrefs } = await sb.from("coach_prefs").select("*");
    for (const p of (allPrefs ?? []) as CoachPrefs[]) {
      if (!dailyTaskDue(p, p.last_derived_on, at)) continue;
      await sweepDerived(sb, p, at);
      // Stamped whether or not it found anything: the question was asked today.
      await sb.from("coach_prefs")
        .update({ last_derived_on: localNow(p.tz, at).date, updated_at: new Date().toISOString() })
        .eq("coach_id", p.coach_id);
      swept++;
    }

    // Only coaches with something waiting. No queue, nothing to do, and the
    // usual pass costs one query.
    const { data: queued } = await sb
      .from("coach_notice_queue").select("id, coach_id, kind, title, body, url, deferred");
    if (!queued?.length) return json({ ok: true, flushed: 0, digested: 0, swept });

    const coachIds = [...new Set(queued.map((r: Row) => r.coach_id))];
    const { data: prefRows } = await sb.from("coach_prefs").select("*").in("coach_id", coachIds);
    const prefsById = new Map<string, CoachPrefs>(
      (prefRows ?? []).map((p: CoachPrefs) => [p.coach_id, p]),
    );

    let flushed = 0, digested = 0;

    for (const coachId of coachIds) {
      const prefs = prefsById.get(coachId) ?? null;
      const mine = queued.filter((r: Row) => r.coach_id === coachId);

      // 1. Deferred instants, once the night is over.
      const held = mine.filter((r: Row) => r.deferred);
      if (held.length && !coachIsQuiet(prefs, at)) {
        for (const r of held) {
          await pushToCoachNow(sb, coachId, { title: r.title, body: r.body, url: r.url });
        }
        await sb.from("coach_notice_queue").delete().in("id", held.map((r: Row) => r.id));
        flushed += held.length;
      }

      // 2. The daily summary. Needs a prefs row: a coach who has never opened
      // the settings has no digest time, so their queue simply waits.
      const forDigest = mine.filter((r: Row) => !r.deferred);
      if (!forDigest.length || !prefs || !digestIsDue(prefs, at)) continue;

      const title = `📋 ${forDigest.length} update${forDigest.length === 1 ? "" : "s"} today`;
      await pushToCoachNow(sb, coachId, { title, body: digestBody(forDigest), url: "./" });
      await sb.from("coach_notice_queue").delete().in("id", forDigest.map((r: Row) => r.id));
      await sb.from("coach_prefs")
        .update({ last_digest_on: localNow(prefs.tz, at).date, updated_at: new Date().toISOString() })
        .eq("coach_id", coachId);
      digested += forDigest.length;
    }

    return json({ ok: true, flushed, digested, swept });
  } catch (e) {
    console.error("[coach-digest] fatal:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

