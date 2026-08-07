// Sends a web-push notification to one or more of the calling coach's
// athletes. Invoked from the app (coach-authenticated) for bulletins and
// manual nudges. VAPID keys live in function secrets:
//   supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:…
//
// Auth model: the caller's JWT must belong to a coach; targets are filtered
// to that coach's own athletes, so one coach can never push to another's.
// Dead subscriptions (endpoint gone: 404/410) are pruned on the way out.
//
// Targets are filtered a second time by the athlete's own notification
// preferences: the `kind` of the push ("bulletin" | "message" | "formcheck")
// must still be switched on for them, and their quiet hours must not be in
// effect. An athlete with no prefs row hears everything.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callerUserId } from "../_shared/caller-auth.ts";
import { allowedTargets, type Prefs, type PushKind } from "../_shared/notify-prefs.ts";
import { pushPayload, sendToSubscriptions, vapidDetails } from "../_shared/webpush.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!vapidDetails()) return json({ error: "VAPID keys not configured" }, 500);

    // Resolve the caller from their JWT, then require a coach row. Via GoTrue
    // over HTTP rather than a client built from SUPABASE_ANON_KEY — that key is
    // managed by Supabase and stopped being a JWT when the project moved to the
    // new key format, silently 401ing everyone. See _shared/caller-auth.ts.
    const userId = await callerUserId(req, supabaseUrl);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);
    const { data: coach } = await sb
      .from("coaches").select("id").eq("auth_user_id", userId).maybeSingle();
    if (!coach) return json({ error: "coaches only" }, 403);

    const { athleteIds, title, body, url, kind } = await req.json();
    if (!Array.isArray(athleteIds) || !athleteIds.length || !title) {
      return json({ error: "athleteIds[] and title required" }, 400);
    }
    const pushKind: PushKind =
      kind === "bulletin" || kind === "message" || kind === "formcheck" ? kind : "message";

    // Only this coach's athletes.
    const { data: athletes } = await sb
      .from("athletes").select("id").eq("coach_id", coach.id).in("id", athleteIds);
    let ids = (athletes ?? []).map((a: { id: string }) => a.id);
    if (!ids.length) return json({ ok: true, sent: 0 });

    // Then only the ones who still want this kind, and aren't in quiet hours.
    const { data: prefs } = await sb
      .from("athlete_prefs").select("*").in("athlete_id", ids);
    const before = ids.length;
    ids = allowedTargets(ids, (prefs ?? []) as Prefs[], pushKind);
    const muted = before - ids.length;
    if (!ids.length) return json({ ok: true, sent: 0, muted });

    const { data: subs } = await sb
      .from("push_subscriptions").select("id, subscription").in("athlete_id", ids);
    if (!subs?.length) return json({ ok: true, sent: 0, muted });

    const { sent, pruned } = await sendToSubscriptions(sb, subs, pushPayload(title, body, url));
    return json({ ok: true, sent, muted, pruned });
  } catch (e) {
    console.error("[send-push] fatal:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
