// "Send me a test" from the coach's notification settings.
//
// Its own function rather than a kind inside notify-coach, because that one
// authenticates the caller as an ATHLETE by design and this caller is the
// coach. It is also the one push in the app that deliberately ignores every
// preference: it bypasses the per-category mode and quiet hours, because the
// question it answers is "does a notification reach this phone at all", and a
// test that could be silently muted would answer nothing.
//
// Push fails silently everywhere else by design, so without this there is no
// way to tell from a phone whether any of the settings work.
//
// POST {} -> { ok, sent }

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callerUserId } from "../_shared/caller-auth.ts";
import { vapidDetails } from "../_shared/webpush.ts";
import { pushToCoachNow } from "../_shared/coach-notify.ts";
import { CORS, preflight } from "../_shared/cors.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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
    const { data: coach } = await sb
      .from("coaches").select("id").eq("auth_user_id", userId).maybeSingle();
    if (!coach) return json({ error: "coaches only" }, 403);

    const { sent, pruned } = await pushToCoachNow(sb, coach.id, {
      title: "🔔 Stone Dragon",
      body: "Notifications are working on this device.",
      url: "./",
    });
    // sent: 0 with no error is the useful answer, not a failure. It means this
    // phone has no subscription, which is a different problem from a muted
    // category and the settings screen says so.
    return json({ ok: true, sent, pruned });
  } catch (e) {
    console.error("[notify-coach-test] fatal:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
