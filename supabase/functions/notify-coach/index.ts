// Tells the coach, on their phone, that an athlete is waiting on them.
//
// This is the only path in the app by which an ATHLETE causes a push to the
// COACH, and that is what dictates its shape: the caller sends an id and
// nothing else. The title and body are built HERE, from the rows. If the caller
// could pass text, any athlete could write anything they liked on the coach's
// lock screen — so they cannot, and adding a `title` parameter to this function
// would undo the whole design.
//
// Why it exists at all: until the booking-changes migration, push_subscriptions
// was athlete-only and send-push required a coach caller and sent to athletes,
// so the coach has never had a notification of any kind. Their only signal was
// the in-app inbox pill, which is no use for a session inside 24 hours if they
// don't happen to open the app.
//
// POST { requestId } -> { ok, sent }
//
// Deployed like send-push: no config.toml entry, so verify_jwt stays on, and no
// CORS block — that combination is what already works from the browser.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callerUserId } from "../_shared/caller-auth.ts";
import { pushPayload, sendToSubscriptions, vapidDetails } from "../_shared/webpush.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// A request is only news for a couple of minutes after it is filed. Re-posting
// the same id later sends nothing, which is what stops a pending request being
// replayed into a stream of notifications on the coach's phone.
const FRESH_MS = 2 * 60 * 1000;

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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!vapidDetails()) return json({ error: "VAPID keys not configured" }, 500);

    const userId = await callerUserId(req, supabaseUrl);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);
    const { data: athlete } = await sb
      .from("athletes").select("id, display_name").eq("auth_user_id", userId).maybeSingle();
    if (!athlete) return json({ error: "athletes only" }, 403);

    const { requestId } = await req.json();
    if (!requestId) return json({ error: "requestId required" }, 400);

    // Scoped to the caller's own request, so an athlete cannot fire a
    // notification about somebody else's session.
    const { data: rq } = await sb
      .from("booking_requests")
      .select("id, kind, status, created_at, new_start_at, coach_id, bookings(start_at)")
      .eq("id", String(requestId))
      .eq("athlete_id", athlete.id)
      .maybeSingle();
    if (!rq) return json({ error: "no such request" }, 404);
    if (rq.status !== "pending") return json({ ok: true, sent: 0, stale: true });
    if (Date.now() - new Date(rq.created_at).getTime() > FRESH_MS) {
      return json({ ok: true, sent: 0, stale: true });
    }

    const { data: coach } = await sb
      .from("coaches").select("availability").eq("id", rq.coach_id).maybeSingle();
    const tz = (coach?.availability as { tz?: string } | null)?.tz || "UTC";

    const name = athlete.display_name || "An athlete";
    const from = (rq.bookings as { start_at: string } | null)?.start_at;
    const body = rq.kind === "cancel"
      ? `${name} wants to cancel ${from ? when(from, tz) : "a session"}`
      : `${name} wants to move ${from ? when(from, tz) : "a session"}` +
        (rq.new_start_at ? ` to ${when(rq.new_start_at, tz)}` : "");

    const { data: subs } = await sb
      .from("push_subscriptions").select("id, subscription").eq("coach_id", rq.coach_id);
    if (!subs?.length) return json({ ok: true, sent: 0 });

    const { sent, pruned } = await sendToSubscriptions(
      sb, subs, pushPayload("⚡ Session change request", body, "./"),
    );
    return json({ ok: true, sent, pruned });
  } catch (e) {
    console.error("[notify-coach] fatal:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
