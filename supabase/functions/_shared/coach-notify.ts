// The one door to the coach's phone.
//
// Every path that wants the coach's attention goes through deliverToCoach, so
// a muted category or a quiet hour cannot be bypassed by a caller that forgot
// to check. See
// docs/superpowers/specs/2026-08-19-coach-push-notifications-design.md.
//
// The text is ALWAYS composed by the server. An athlete supplies an id and
// nothing else; see the header of notify-coach/index.ts for what breaks if
// that is ever relaxed.

import { inQuietHours, localNow, minutesOfDay } from "./notify-prefs.ts";
import { pushPayload, sendToSubscriptions, type PushSub } from "./webpush.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export type CoachMode = "off" | "instant" | "digest";

export type CoachPrefs = {
  coach_id: string;
  notify_modes: Record<string, CoachMode> | null;
  tz: string;
  digest_at: string;
  last_digest_on: string | null;
  quiet_on: boolean;
  quiet_from: string;
  quiet_to: string;
};

/**
 * Default mode per kind. MUST match `def` in src/notify/coach-kinds.js, which
 * is the canonical list; src/notify/coach-kinds.spec.js reads this literal as
 * text and fails if the two disagree. Deno cannot import that file, so this is
 * a deliberate copy with a test holding it honest rather than a second source
 * of truth.
 */
export const DEFAULT_MODES: Record<string, CoachMode> = {
  workout_logged: "digest",
  pr_set: "digest",
  day_skipped: "digest",
  readiness_low: "instant",
  session_note: "digest",
  athlete_quiet: "digest",
  message: "instant",
  form_check: "instant",
  invite_claimed: "instant",
  bug_report: "instant",
  booking_request: "instant",
  booking_made: "instant",
  booking_cancelled: "instant",
  balance_zero: "instant",
  payment_in: "digest",
  charge_failed: "instant",
  month_uncollected: "digest",
};

/** A coach with no prefs row gets the defaults, not silence. */
export function modeFor(prefs: CoachPrefs | null, kind: string): CoachMode {
  const fallback = DEFAULT_MODES[kind];
  if (!fallback) return "off"; // unknown kind: never invent a notification
  const picked = prefs?.notify_modes?.[kind];
  return picked === "off" || picked === "instant" || picked === "digest" ? picked : fallback;
}

/**
 * Quiet hours for a coach. notify-prefs.inQuietHours wants an athlete-shaped
 * row, so this adapts rather than duplicating the wrap-past-midnight logic,
 * which is the part that is easy to get wrong twice.
 */
export function coachIsQuiet(prefs: CoachPrefs | null, at = new Date()): boolean {
  if (!prefs) return false;
  // deno-lint-ignore no-explicit-any
  return inQuietHours({
    quiet_on: prefs.quiet_on,
    quiet_from: prefs.quiet_from,
    quiet_to: prefs.quiet_to,
    tz: prefs.tz,
  } as any, at);
}

/** True once the coach's local clock has passed their chosen digest time. */
export function digestIsDue(prefs: CoachPrefs, at = new Date()): boolean {
  const want = minutesOfDay(prefs.digest_at);
  if (want == null) return false;
  const now = localNow(prefs.tz, at);
  if (prefs.last_digest_on === now.date) return false; // already sent today
  return now.minutes >= want;
}

export async function getCoachPrefs(sb: Db, coachId: string): Promise<CoachPrefs | null> {
  const { data } = await sb.from("coach_prefs").select("*").eq("coach_id", coachId).maybeSingle();
  return (data ?? null) as CoachPrefs | null;
}

export type Notice = { title: string; body: string; url?: string };

/** Push straight to every device this coach has enabled. No pref checks. */
export async function pushToCoachNow(sb: Db, coachId: string, n: Notice) {
  const { data: subs } = await sb
    .from("push_subscriptions").select("id, subscription").eq("coach_id", coachId);
  if (!subs?.length) return { sent: 0, pruned: 0 };
  return await sendToSubscriptions(sb, subs as PushSub[], pushPayload(n.title, n.body, n.url ?? "./"));
}

export async function queueForCoach(sb: Db, coachId: string, kind: string, n: Notice, deferred: boolean) {
  await sb.from("coach_notice_queue").insert({
    coach_id: coachId, kind, title: n.title, body: n.body, url: n.url ?? "./", deferred,
  });
}

/**
 * The seam. Resolves the mode, then sends, queues for the digest, or queues as
 * a deferred instant because right now is the middle of the night.
 *
 * Deferring rather than dropping is the one place this differs from the
 * athlete side: an athlete losing a bulletin at 2am costs nothing, a coach
 * losing a failed card charge overnight costs money.
 */
export async function deliverToCoach(
  sb: Db, coachId: string, kind: string, n: Notice, at = new Date(),
): Promise<"sent" | "queued" | "deferred" | "muted"> {
  if (!coachId || !kind) return "muted";
  const prefs = await getCoachPrefs(sb, coachId);
  const mode = modeFor(prefs, kind);
  if (mode === "off") return "muted";
  if (mode === "digest") {
    await queueForCoach(sb, coachId, kind, n, false);
    return "queued";
  }
  if (coachIsQuiet(prefs, at)) {
    await queueForCoach(sb, coachId, kind, n, true);
    return "deferred";
  }
  await pushToCoachNow(sb, coachId, n);
  return "sent";
}
