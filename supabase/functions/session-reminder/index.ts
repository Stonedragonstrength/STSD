// "Your session is at 4:00" — the reminder for a booked appointment.
//
// Distinct from workout-reminder, which nudges at a wall-clock time the
// athlete picked and goes quiet on days they already trained. This one is
// about a commitment: it fires ahead of a real row in `bookings`, and the only
// thing that stops it is the athlete turning it off.
//
// Runs every 15 minutes via pg_cron (20260802120000_session_reminders.sql).
// Two things keep it honest:
//   * bookings.reminder_sent_at — one push per booking, ever, so a coach
//     moving a session or the cron double-firing can't buzz someone twice;
//   * the lead window is "any time from lead-before until the session starts",
//     not a 15-minute slice, so a missed tick sends late instead of never.
//
// Quiet hours are deliberately NOT applied. A suppressed reminder for a 6am
// session would arrive after the session, which is worse than no reminder at
// all — the per-athlete switch is the control here.
//
// Callable only with the service-role JWT the cron sends (never from the app).

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { type Prefs } from "../_shared/notify-prefs.ts";

// The furthest ahead any athlete may ask to be warned, and therefore how far
// forward the query has to look.
const MAX_LEAD_MIN = 24 * 60;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Booking = {
  id: string;
  athlete_id: string;
  start_at: string;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const vapidPub = Deno.env.get("VAPID_PUBLIC_KEY");
    const vapidPriv = Deno.env.get("VAPID_PRIVATE_KEY");
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ??
      "mailto:admin@stonedragonstrengthtraining.com";

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth.includes(serviceKey)) return json({ error: "forbidden" }, 403);
    if (!vapidPub || !vapidPriv) return json({ error: "VAPID keys not configured" }, 500);

    const sb = createClient(supabaseUrl, serviceKey);
    const now = new Date();

    // Everything still ahead of us that nobody has been told about, out to the
    // longest lead anyone could have set.
    const { data: rows } = await sb
      .from("bookings")
      .select("id, athlete_id, start_at")
      .eq("status", "booked")
      .is("reminder_sent_at", null)
      .gte("start_at", now.toISOString())
      .lte("start_at", new Date(now.getTime() + MAX_LEAD_MIN * 60000).toISOString())
      .order("start_at", { ascending: true });
    const upcoming = (rows ?? []) as Booking[];
    if (!upcoming.length) return json({ ok: true, sent: 0, due: 0 });

    const athleteIds = [...new Set(upcoming.map((b) => b.athlete_id))];
    const { data: prefRows } = await sb
      .from("athlete_prefs").select("*").in("athlete_id", athleteIds);
    const prefs = new Map(((prefRows ?? []) as Prefs[]).map((p) => [p.athlete_id, p]));

    // A missing prefs row means an athlete who never opened Profile: reminders
    // on, two hours, their timezone unknown so the coach's reading of the clock
    // is the best available. The push says a time, so tz matters here.
    const due = upcoming.filter((b) => {
      const p = prefs.get(b.athlete_id);
      if (p && p.notify_sessions === false) return false;
      const lead = Math.min(MAX_LEAD_MIN, Math.max(5, p?.session_lead_mins ?? 120));
      const startMs = Date.parse(b.start_at);
      if (!Number.isFinite(startMs)) return false;
      return now.getTime() >= startMs - lead * 60000;
    });
    if (!due.length) return json({ ok: true, sent: 0, due: 0 });

    const { data: subs } = await sb
      .from("push_subscriptions").select("id, athlete_id, subscription")
      .in("athlete_id", [...new Set(due.map((b) => b.athlete_id))]);
    const byAthlete = new Map<string, { id: string; subscription: unknown }[]>();
    for (const s of (subs ?? []) as { id: string; athlete_id: string; subscription: unknown }[]) {
      const list = byAthlete.get(s.athlete_id) ?? [];
      list.push({ id: s.id, subscription: s.subscription });
      byAthlete.set(s.athlete_id, list);
    }

    webpush.setVapidDetails(vapidSubject, vapidPub, vapidPriv);

    let sent = 0;
    const dead: string[] = [];
    const stamped: string[] = [];

    for (const b of due) {
      const p = prefs.get(b.athlete_id);
      const tz = p?.tz && p.tz !== "UTC" ? p.tz : undefined;
      const when = fmtTime(b.start_at, tz);
      const mins = Math.round((Date.parse(b.start_at) - now.getTime()) / 60000);
      const payload = JSON.stringify({
        title: "Session today 🏋️",
        body: mins <= 75
          ? `You're training at ${when} — about ${mins} minutes away.`
          : `You're training at ${when}.`,
        url: "./",
      });
      const list = byAthlete.get(b.athlete_id) ?? [];
      // No subscription is not a failure — they simply have no device
      // registered. Stamping anyway stops the row being rescanned every 15
      // minutes until the session starts.
      for (const s of list) {
        try {
          await webpush.sendNotification(s.subscription as never, payload);
          sent++;
        } catch (e) {
          const code = (e as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) dead.push(s.id);
          else console.error("[session-reminder] send failed:", code, e);
        }
      }
      stamped.push(b.id);
    }

    if (dead.length) await sb.from("push_subscriptions").delete().in("id", dead);
    if (stamped.length) {
      await sb.from("bookings")
        .update({ reminder_sent_at: now.toISOString() })
        .in("id", stamped);
    }

    return json({ ok: true, sent, due: due.length, pruned: dead.length });
  } catch (e) {
    console.error("[session-reminder] fatal:", e);
    return json({ ok: false, error: String(e) }, 500);
  }
});

function fmtTime(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric", minute: "2-digit", timeZone: tz,
    });
  } catch {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
}
