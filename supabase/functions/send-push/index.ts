// Sends a web-push notification to one or more of the calling coach's
// athletes. Invoked from the app (coach-authenticated) for bulletins and
// manual nudges. VAPID keys live in function secrets:
//   supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:…
//
// Auth model: the caller's JWT must belong to a coach; targets are filtered
// to that coach's own athletes, so one coach can never push to another's.
// Dead subscriptions (endpoint gone: 404/410) are pruned on the way out.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPub = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPriv = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@stonedragonstrengthtraining.com";
    if (!vapidPub || !vapidPriv) return json({ error: "VAPID keys not configured" }, 500);

    // Resolve the caller from their JWT, then require a coach row.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);
    const { data: coach } = await sb
      .from("coaches").select("id").eq("auth_user_id", user.id).maybeSingle();
    if (!coach) return json({ error: "coaches only" }, 403);

    const { athleteIds, title, body, url } = await req.json();
    if (!Array.isArray(athleteIds) || !athleteIds.length || !title) {
      return json({ error: "athleteIds[] and title required" }, 400);
    }

    // Only this coach's athletes.
    const { data: athletes } = await sb
      .from("athletes").select("id").eq("coach_id", coach.id).in("id", athleteIds);
    const ids = (athletes ?? []).map((a: { id: string }) => a.id);
    if (!ids.length) return json({ ok: true, sent: 0 });

    const { data: subs } = await sb
      .from("push_subscriptions").select("id, subscription").in("athlete_id", ids);
    if (!subs?.length) return json({ ok: true, sent: 0 });

    webpush.setVapidDetails(vapidSubject, vapidPub, vapidPriv);
    const payload = JSON.stringify({
      title: String(title).slice(0, 120),
      body: String(body ?? "").slice(0, 400),
      url: typeof url === "string" ? url : "./",
    });

    let sent = 0;
    const dead: string[] = [];
    await Promise.all(subs.map(async (s: { id: string; subscription: unknown }) => {
      try {
        await webpush.sendNotification(s.subscription as never, payload);
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
        else console.error("[send-push] send failed:", code, e);
      }
    }));
    if (dead.length) await sb.from("push_subscriptions").delete().in("id", dead);

    return json({ ok: true, sent, pruned: dead.length });
  } catch (e) {
    console.error("[send-push] fatal:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
