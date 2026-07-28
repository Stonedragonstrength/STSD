// The athlete's own "time to train" nudge.
//
// Runs every 15 minutes via pg_cron (see 20260728120100_workout_reminder_cron.sql)
// and pushes to anyone whose chosen reminder time has just come round in their
// own timezone. Three things stop it from ever nagging:
//   * last_reminder_on — one nudge per local day, whatever the cron does;
//   * a completion logged today — someone who trained at 6am hears nothing;
//   * no push subscription — nothing to send to.
//
// Callable only with the service-role JWT the cron sends (never from the app).

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { localNow, minutesOfDay, type Prefs } from "../_shared/notify-prefs.ts";

// How late a nudge may still fire. Matches the cron interval, so a reminder
// set for 17:00 goes out on the 17:00 tick and never twice.
const WINDOW_MIN = 15;

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
    const vapidPub = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPriv = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@stonedragonstrengthtraining.com";

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.includes(serviceKey)) return json({ error: "forbidden" }, 403);
    if (!vapidPub || !vapidPriv) return json({ error: "VAPID keys not configured" }, 500);

    const sb = createClient(supabaseUrl, serviceKey);
    const { data: rows } = await sb
      .from("athlete_prefs").select("*").eq("reminder_on", true);
    const prefs = (rows ?? []) as Prefs[];
    if (!prefs.length) return json({ ok: true, sent: 0, due: 0 });

    const at = new Date();
    const due = prefs.filter((p) => {
      const want = minutesOfDay(p.reminder_time);
      if (want == null) return false;
      const now = localNow(p.tz, at);
      if (p.last_reminder_on === now.date) return false;
      return now.minutes >= want && now.minutes < want + WINDOW_MIN;
    });
    if (!due.length) return json({ ok: true, sent: 0, due: 0 });

    const dueIds = due.map((p) => p.athlete_id);
    // Anyone who already logged a workout today doesn't need telling.
    const { data: progressRows } = await sb
      .from("progress").select("athlete_id, day_completions").in("athlete_id", dueIds);
    const trainedToday = new Set<string>();
    for (const row of progressRows ?? []) {
      const p = due.find((x) => x.athlete_id === row.athlete_id);
      if (!p) continue;
      const today = localNow(p.tz, at).date;
      const dc = (row.day_completions ?? {}) as Record<string, unknown>;
      const hit = Object.values(dc).some((v) => Array.isArray(v) && v.includes(today));
      if (hit) trainedToday.add(row.athlete_id);
    }
    const targets = due.filter((p) => !trainedToday.has(p.athlete_id));
    if (!targets.length) {
      await stamp(sb, due, at); // still stamp, so nobody gets a late second look
      return json({ ok: true, sent: 0, due: due.length, skipped: trainedToday.size });
    }

    const { data: subs } = await sb
      .from("push_subscriptions").select("id, athlete_id, subscription")
      .in("athlete_id", targets.map((p) => p.athlete_id));

    webpush.setVapidDetails(vapidSubject, vapidPub, vapidPriv);
    const payload = JSON.stringify({
      title: "Time to train 💪",
      body: "Your workout is waiting. Tap to open it.",
      url: "./",
    });

    let sent = 0;
    const dead: string[] = [];
    await Promise.all((subs ?? []).map(async (s: { id: string; subscription: unknown }) => {
      try {
        await webpush.sendNotification(s.subscription as never, payload);
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
        else console.error("[workout-reminder] send failed:", code, e);
      }
    }));
    if (dead.length) await sb.from("push_subscriptions").delete().in("id", dead);

    await stamp(sb, due, at);
    return json({ ok: true, sent, due: due.length, skipped: trainedToday.size, pruned: dead.length });
  } catch (e) {
    console.error("[workout-reminder] fatal:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

// Mark today as handled for everyone whose time came round, sent or not.
async function stamp(sb: ReturnType<typeof createClient>, due: Prefs[], at: Date) {
  await Promise.all(due.map((p) =>
    sb.from("athlete_prefs")
      .update({ last_reminder_on: localNow(p.tz, at).date })
      .eq("athlete_id", p.athlete_id)
  ));
}
