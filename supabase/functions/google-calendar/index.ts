// Google Calendar connection for the coach's schedule.
//
// Everything Google-facing lives here because the OAuth client secret and the
// long-lived refresh token must never reach a browser: this repo is public and
// every file in it ships to athletes in plaintext, same reasoning as the USDA
// key in food-search and the VAPID private key in send-push. The refresh token
// is stored in public.google_calendar, a table with RLS on and no policies, so
// only this function's service-role client can read it.
//
// Actions (POST { action, ... }):
//   status      -> { connected, email, calendarId }
//   auth-url    -> { url }              the consent screen to send the coach to
//   exchange    -> { code }             swap the one-time code for a refresh token
//   disconnect  -> forget the token
//   freebusy    -> { from, to }         busy intervals, for hiding taken slots
//   push        -> { bookingId }        create/update the event for a booking
//   remove      -> { bookingId }        delete the event a booking owns
//
// Only the coach may call any of them.
//
// Setup (one time, by the coach — none of this can be done from the app):
//   1. Google Cloud console -> new project -> APIs & Services -> enable
//      "Google Calendar API".
//   2. OAuth consent screen: External, add yourself as a test user. Calendar
//      scopes are "sensitive", so an unverified app shows a warning screen and
//      caps at 100 users. For a single-coach app that is fine forever.
//   3. Credentials -> OAuth client ID -> Web application. Authorised redirect
//      URI must EXACTLY match the app origin, e.g.
//      https://stonedragonstrength.github.io/STSD/
//   4. supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
//        GOOGLE_REDIRECT_URI=https://stonedragonstrength.github.io/STSD/
//   5. supabase functions deploy google-calendar --use-api

import { createClient } from "jsr:@supabase/supabase-js@2";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_API = "https://www.googleapis.com/calendar/v3";
// events = write the booking; readonly = query free/busy so we can hide slots
// the coach is already busy for.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A short-lived access token, minted from the stored refresh token. */
async function accessToken(refreshToken: string, clientId: string, clientSecret: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    // invalid_grant means the coach revoked access or the token aged out;
    // the caller records it so the UI can say "reconnect" instead of failing
    // silently forever.
    throw new Error(data?.error ?? `token ${res.status}`);
  }
  return String(data.access_token);
}

Deno.serve(async (req) => {
  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let body: any = {};
    try { body = await req.json(); } catch { /* handled by the action switch */ }
    const action = String(body?.action ?? "");

    // ---- who is calling ----
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ ok: false, error: "not signed in" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);
    const { data: coach } = await sb.from("coaches").select("id").eq("auth_user_id", user.id).maybeSingle();
    if (!coach) return json({ ok: false, error: "coach only" }, 403);
    const coachId = coach.id as string;

    if (!clientId || !clientSecret || !redirectUri) {
      // Named individually: these are matched EXACTLY, and getting one name
      // wrong in the dashboard looks identical to not having set it at all.
      const missing = [
        clientId ? null : "GOOGLE_CLIENT_ID",
        clientSecret ? null : "GOOGLE_CLIENT_SECRET",
        redirectUri ? null : "GOOGLE_REDIRECT_URI",
      ].filter(Boolean);
      // 200, deliberately. supabase-js treats any non-2xx as an error and
      // throws the body away, so an explanation sent with an error status can
      // never reach the UI. This is an expected state, not a server fault.
      return json({ ok: false, error: "not configured", needsSetup: true, missing });
    }

    const loadToken = async () => {
      const { data } = await sb.from("google_calendar").select("*").eq("coach_id", coachId).maybeSingle();
      return data ?? null;
    };
    const noteError = async (msg: string) => {
      await sb.from("google_calendar").update({ last_error: msg.slice(0, 300) }).eq("coach_id", coachId);
    };

    switch (action) {
      case "status": {
        const row = await loadToken();
        return json({
          ok: true,
          connected: !!row,
          email: row?.account_email ?? "",
          calendarId: row?.calendar_id ?? "primary",
          lastError: row?.last_error ?? "",
        });
      }

      case "auth-url": {
        const url = `${AUTH_URL}?` + new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: SCOPES,
          // offline + consent is what actually returns a refresh token. Without
          // prompt=consent Google withholds it on every grant after the first,
          // which looks like a random intermittent failure.
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
          state: coachId,
        });
        return json({ ok: true, url });
      }

      case "exchange": {
        const code = String(body?.code ?? "");
        if (!code) return json({ ok: false, error: "no code" }, 400);
        const res = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code, client_id: clientId, client_secret: clientSecret,
            redirect_uri: redirectUri, grant_type: "authorization_code",
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.refresh_token) {
          console.error("[google-calendar] exchange failed", res.status, data?.error);
          return json({ ok: false, error: data?.error ?? "exchange failed" }, 400);
        }
        // Which account this landed on, so the coach can see they linked the
        // right calendar.
        let email = "";
        try {
          const me = await fetch(`${CAL_API}/calendars/primary`, {
            headers: { Authorization: `Bearer ${data.access_token}` },
          });
          if (me.ok) email = String((await me.json())?.id ?? "");
        } catch { /* cosmetic only */ }
        const { error } = await sb.from("google_calendar").upsert({
          coach_id: coachId,
          refresh_token: data.refresh_token,
          calendar_id: "primary",
          account_email: email,
          connected_at: new Date().toISOString(),
          last_error: null,
        });
        if (error) return json({ ok: false, error: error.message }, 500);
        return json({ ok: true, email });
      }

      case "disconnect": {
        await sb.from("google_calendar").delete().eq("coach_id", coachId);
        return json({ ok: true });
      }

      case "freebusy": {
        const row = await loadToken();
        if (!row) return json({ ok: true, connected: false, busy: [] });
        try {
          const token = await accessToken(row.refresh_token, clientId, clientSecret);
          const res = await fetch(`${CAL_API}/freeBusy`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              timeMin: String(body?.from ?? new Date().toISOString()),
              timeMax: String(body?.to ?? new Date(Date.now() + 30 * 864e5).toISOString()),
              items: [{ id: row.calendar_id || "primary" }],
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error?.message ?? `freebusy ${res.status}`);
          const cal = data?.calendars?.[row.calendar_id || "primary"];
          return json({ ok: true, connected: true, busy: cal?.busy ?? [] });
        } catch (e) {
          await noteError(String(e));
          // Busy-lookup failure must not take booking down with it: the app
          // falls back to bookings-only availability, which is never wrong,
          // only less informed.
          return json({ ok: true, connected: true, busy: [], degraded: String(e) });
        }
      }

      case "push":
      case "remove": {
        const bookingId = String(body?.bookingId ?? "");
        if (!bookingId) return json({ ok: false, error: "no booking" }, 400);
        const row = await loadToken();
        if (!row) return json({ ok: true, connected: false });
        const { data: bk } = await sb.from("bookings")
          .select("*, athletes(name)").eq("id", bookingId).eq("coach_id", coachId).maybeSingle();
        if (!bk) return json({ ok: false, error: "no such booking" }, 404);

        try {
          const token = await accessToken(row.refresh_token, clientId, clientSecret);
          const cal = encodeURIComponent(row.calendar_id || "primary");
          const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

          const shouldExist = action === "push" && bk.status === "booked";
          if (!shouldExist) {
            if (bk.google_event_id) {
              await fetch(`${CAL_API}/calendars/${cal}/events/${encodeURIComponent(bk.google_event_id)}`,
                { method: "DELETE", headers: auth });
              await sb.from("bookings").update({ google_event_id: null }).eq("id", bookingId);
            }
            return json({ ok: true, removed: true });
          }

          const name = (bk as any).athletes?.name ?? "Athlete";
          const event = {
            summary: `Training: ${name}`,
            description: bk.note ? String(bk.note) : "Booked in Stone Dragon.",
            start: { dateTime: new Date(bk.start_at).toISOString() },
            end: { dateTime: new Date(bk.end_at).toISOString() },
          };
          const url = bk.google_event_id
            ? `${CAL_API}/calendars/${cal}/events/${encodeURIComponent(bk.google_event_id)}`
            : `${CAL_API}/calendars/${cal}/events`;
          const res = await fetch(url, {
            method: bk.google_event_id ? "PATCH" : "POST",
            headers: auth,
            body: JSON.stringify(event),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.error?.message ?? `event ${res.status}`);
          if (!bk.google_event_id && data?.id) {
            await sb.from("bookings").update({ google_event_id: data.id }).eq("id", bookingId);
          }
          await sb.from("google_calendar").update({ last_error: null }).eq("coach_id", coachId);
          return json({ ok: true, eventId: data?.id ?? bk.google_event_id });
        } catch (e) {
          await noteError(String(e));
          // The booking itself already succeeded in our database. Google
          // failing is a sync problem, not a booking problem, and must never
          // roll the booking back.
          console.error("[google-calendar] push failed", e);
          return json({ ok: false, error: String(e), soft: true });
        }
      }

      default:
        return json({ ok: false, error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error("[google-calendar] fatal:", e);
    return json({ ok: false, error: "failed" }, 500);
  }
});
