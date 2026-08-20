// Tells the coach, on their phone, that something happened on their roster.
//
// This is the only path in the app by which an ATHLETE causes a push to the
// COACH, and that is what dictates its shape: the caller sends a kind and an
// id, and nothing else. The title and body are built on the server, from the
// rows, by the recipe for that kind. If the caller could pass text, any
// athlete could write anything they liked on the coach's lock screen, so they
// cannot, and adding a `title` parameter to this function would undo the whole
// design.
//
// It started life handling one kind (a booking request) with the body written
// inline. Everything is now a recipe in _shared/coach-recipes.ts and delivery
// goes through _shared/coach-notify.ts, which is what applies the coach's
// per-category mode and quiet hours. See
// docs/superpowers/specs/2026-08-19-coach-push-notifications-design.md.
//
// POST { kind, refId } -> { ok, result }
// POST { requestId }   -> the old shape, still accepted; see below.
//
// Deployed like send-push: no config.toml entry, so verify_jwt stays on, and no
// CORS block. That combination is what already works from the browser.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callerUserId } from "../_shared/caller-auth.ts";
import { vapidDetails } from "../_shared/webpush.ts";
import { deliverToCoach } from "../_shared/coach-notify.ts";
import { RECIPES, type Athlete } from "../_shared/coach-recipes.ts";
import { CORS, preflight } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// An event is only news for a couple of minutes. Re-posting the same id later
// sends nothing, which is what stops a pending request, or a day finished last
// week, being replayed into a stream of notifications on the coach's phone.
const FRESH_MS = 2 * 60 * 1000;

// Kinds whose freshness cannot be read off a row, because the event lives in
// the athlete's progress blob and has no per-event timestamp. The client fires
// these at the moment they happen, and the replay guard for them is that the
// digest de-duplicates and an instant repeat is bounded by how fast a human can
// tap. Listed explicitly so adding a kind is a decision, not an oversight.
const NO_ROW_CLOCK = new Set([
  "workout_logged", "day_skipped", "pr_set", "readiness_low", "session_note", "form_check",
]);

Deno.serve(async (req) => {
  // A preflight carries no body and no credentials: answer it first.
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!vapidDetails()) return json({ error: "VAPID keys not configured" }, 500);

    const userId = await callerUserId(req, supabaseUrl);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);
    const { data: athlete } = await sb
      .from("athletes").select("id, display_name, coach_id")
      .eq("auth_user_id", userId).maybeSingle();
    if (!athlete) return json({ error: "athletes only" }, 403);
    if (!athlete.coach_id) return json({ ok: true, result: "no coach" });

    const payload = await req.json();
    // The original call shape. Kept working so the rewrite and the client
    // change do not have to land in the same deploy.
    const kind = String(payload?.kind || (payload?.requestId ? "booking_request" : "")).trim();
    const refId = String(payload?.refId ?? payload?.requestId ?? "").trim();
    if (!kind || !refId) return json({ error: "kind and refId required" }, 400);

    const recipe = RECIPES[kind];
    if (!recipe) return json({ error: `unknown kind ${kind}` }, 400);

    // Freshness, where there is a row clock to read it from.
    if (!NO_ROW_CLOCK.has(kind)) {
      const table = kind === "booking_request" ? "booking_requests"
        : kind.startsWith("booking_") ? "bookings"
        : kind === "message" ? "messages"
        : kind === "bug_report" ? "bug_reports"
        : null;
      if (table) {
        const { data: row } = await sb.from(table).select("created_at").eq("id", refId).maybeSingle();
        if (row?.created_at && Date.now() - new Date(row.created_at).getTime() > FRESH_MS) {
          return json({ ok: true, result: "stale" });
        }
      }
    }

    const notice = await recipe(sb, athlete as Athlete, refId);
    // A recipe returning null means the event did not happen, is not this
    // athlete's, or is not something the coach programmed. Silence, not an
    // error: the client fires these optimistically.
    if (!notice) return json({ ok: true, result: "nothing to say" });

    const result = await deliverToCoach(sb, athlete.coach_id, kind, notice);
    return json({ ok: true, result });
  } catch (e) {
    console.error("[notify-coach] fatal:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
