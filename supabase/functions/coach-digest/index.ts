// The coach's daily summary, and the catch-up for anything quiet hours held
// back. Runs every 15 minutes on pg_cron.
//
// Two jobs in one pass, which is why it cannot simply run once a day at the
// digest hour:
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
  coachIsQuiet, digestIsDue, pushToCoachNow, type CoachPrefs,
} from "../_shared/coach-notify.ts";

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

Deno.serve(async (req) => {
  if (!isServiceRoleCaller(req.headers.get("Authorization"))) {
    return json({ error: "forbidden" }, 403);
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!vapidDetails()) return json({ error: "VAPID keys not configured" }, 500);
    const sb = createClient(supabaseUrl, serviceKey);

    // Only coaches with something waiting. No queue, nothing to do, and the
    // usual pass costs one query.
    const { data: queued } = await sb
      .from("coach_notice_queue").select("id, coach_id, kind, title, body, url, deferred");
    if (!queued?.length) return json({ ok: true, flushed: 0, digested: 0 });

    const coachIds = [...new Set(queued.map((r: Row) => r.coach_id))];
    const { data: prefRows } = await sb.from("coach_prefs").select("*").in("coach_id", coachIds);
    const prefsById = new Map<string, CoachPrefs>(
      (prefRows ?? []).map((p: CoachPrefs) => [p.coach_id, p]),
    );

    let flushed = 0, digested = 0;
    const at = new Date();

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

    return json({ ok: true, flushed, digested });
  } catch (e) {
    console.error("[coach-digest] fatal:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

