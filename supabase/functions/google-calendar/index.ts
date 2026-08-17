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
//   push-series -> { seriesId, from }   same, for a whole weekly series
//   remove-series -> { seriesId, from } delete a whole weekly series' events
//   push-all    -> { from, batch }      RECONCILE: delete the events of bookings
//                                       that were cancelled while Google was
//                                       unreachable, then backfill every future
//                                       booking with no event yet. Returns what
//                                       remains so the caller can loop until done
//
// The coach may call any of them. An athlete may call only `push` and `remove`,
// and only for a booking of their own — that is what keeps the coach's calendar
// honest when an athlete books, moves or cancels a session themselves.
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
import { callerUserId } from "../_shared/caller-auth.ts";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAL_API = "https://www.googleapis.com/calendar/v3";
// events = write the booking; readonly = query free/busy so we can hide slots
// the coach is already busy for.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

// CORS. The browser sends a preflight for this call (it carries Authorization
// and a JSON content type), and a preflight never carries credentials — so the
// gateway's verify_jwt must be OFF for this function or it answers the
// preflight with a 401 and the real request never leaves the browser. That
// costs nothing in safety: the handler below authenticates every call itself
// and 401s an anonymous one. Deploy with --no-verify-jwt (and see config.toml).
// Origin is "*" because access is decided by the JWT, not by where the page is.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

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
  // Answer the preflight before anything else — it has no body and no auth.
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let body: any = {};
    try { body = await req.json(); } catch { /* handled by the action switch */ }
    const action = String(body?.action ?? "");

    // ---- who is calling ----
    // Via GoTrue over HTTP, not a client built from SUPABASE_ANON_KEY — that
    // key is managed by Supabase and stopped being a JWT when the project moved
    // to the new key format, which silently 401'd every caller. See
    // _shared/caller-auth.ts.
    const userId = await callerUserId(req, supabaseUrl);
    if (!userId) return json({ ok: false, error: "not signed in" }, 401);

    const sb = createClient(supabaseUrl, serviceKey);
    const { data: coach } = await sb.from("coaches").select("id").eq("auth_user_id", userId).maybeSingle();

    // Coaches reach everything. An athlete reaches exactly two actions, for
    // exactly one booking: their own.
    //
    // This used to be a flat "coach only" 403, and that was a silent bug rather
    // than a policy. `doBook()` has always fired push after a self-booking and
    // always had it rejected — with the failure swallowed, because a Google
    // problem must never undo a booking. The result was that an athlete's own
    // bookings never appeared on the coach's calendar at all, and cancelling
    // one couldn't take it off. Self-service scheduling is worse than useless
    // if the coach's calendar quietly disagrees with the app, so the athlete
    // gets the narrowest possible door: push and remove, nothing else, and the
    // coach whose calendar is written is read off the BOOKING, never the request.
    let coachId: string;
    let athleteId: string | null = null;
    if (coach) {
      coachId = coach.id as string;
    } else {
      if (action !== "push" && action !== "remove") return json({ ok: false, error: "coach only" }, 403);
      const { data: athlete } = await sb
        .from("athletes").select("id").eq("auth_user_id", userId).maybeSingle();
      if (!athlete) return json({ ok: false, error: "coach only" }, 403);
      const { data: bk } = await sb
        .from("bookings").select("athlete_id, coach_id")
        .eq("id", String(body?.bookingId ?? "")).maybeSingle();
      if (!bk || bk.athlete_id !== athlete.id) return json({ ok: false, error: "not your booking" }, 403);
      coachId = bk.coach_id as string;
      athleteId = athlete.id as string;
    }

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

    // One booking -> one calendar event. Shared by the targeted pushes and the
    // backfill so there is exactly one definition of what an event looks like.
    // Re-running is safe: a booking that already owns an event is PATCHed by
    // google_event_id rather than posted again, which is what makes a failed
    // half-finished run recoverable by simply running it again.
    const writeEvent = async (bk: any, cal: string, auth: Record<string, string>) => {
      // display_name, not name: the athletes table has never had a `name`
      // column, and asking for one made PostgREST 400 the whole select. Because
      // the callers below destructured only `data`, that error was thrown away
      // and every push -- single, series, all of them -- quietly matched zero
      // rows. The symptom was an empty Google Calendar with no error anywhere.
      const name = bk?.athletes?.display_name ?? "Athlete";
      const event = {
        summary: `Training: ${name}`,
        description: bk.note ? String(bk.note) : "Booked in Stone Dragon.",
        start: { dateTime: new Date(bk.start_at).toISOString() },
        end: { dateTime: new Date(bk.end_at).toISOString() },
      };
      const url = bk.google_event_id
        ? `${CAL_API}/calendars/${cal}/events/${encodeURIComponent(bk.google_event_id)}`
        : `${CAL_API}/calendars/${cal}/events`;

      // Calendar meters WRITES to a single calendar far more tightly than it
      // meters requests, and a backfill is nothing but writes to one calendar.
      // Pushing a few hundred flat out earns a 403 "Rate Limit Exceeded" partway
      // through, so each write backs off and retries rather than abandoning the
      // run. Rate limiting is the expected state here, not a fault.
      let data: any = null;
      for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, {
          method: bk.google_event_id ? "PATCH" : "POST",
          headers: auth,
          body: JSON.stringify(event),
        });
        data = await res.json();
        if (res.ok) break;
        const msg = String(data?.error?.message ?? `event ${res.status}`);
        const limited = res.status === 429 || res.status === 403;
        if (!limited || attempt >= 4) throw new Error(msg);
        await sleep(400 * Math.pow(2, attempt) + Math.random() * 250);
      }
      if (!bk.google_event_id && data?.id) {
        await sb.from("bookings").update({ google_event_id: data.id }).eq("id", bk.id);
      }
    };
    const dropEvent = async (bk: any, cal: string, auth: Record<string, string>) => {
      if (!bk.google_event_id) return false;
      await fetch(`${CAL_API}/calendars/${cal}/events/${encodeURIComponent(bk.google_event_id)}`,
        { method: "DELETE", headers: auth });
      await sb.from("bookings").update({ google_event_id: null }).eq("id", bk.id);
      return true;
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
      case "remove":
      case "push-series":
      case "remove-series": {
        const series = action.endsWith("-series");
        // A weekly booking is stored as one row per session, so a year-long
        // series would otherwise be 52 round trips from the browser. The whole
        // series is handled in one call instead, capped so a bad id can't spin.
        let q = sb.from("bookings").select("*, athletes(display_name)").eq("coach_id", coachId);
        // Belt and braces for an athlete caller: ownership was proved above,
        // but keeping the constraint on the query means it cannot be lost by a
        // later edit to the block that set athleteId.
        if (athleteId) q = q.eq("athlete_id", athleteId);
        if (series) {
          const seriesId = String(body?.seriesId ?? "");
          if (!seriesId) return json({ ok: false, error: "no series" }, 400);
          q = q.eq("series_id", seriesId)
            .gte("start_at", String(body?.from ?? new Date().toISOString()))
            .order("start_at", { ascending: true }).limit(120);
        } else {
          const bookingId = String(body?.bookingId ?? "");
          if (!bookingId) return json({ ok: false, error: "no booking" }, 400);
          q = q.eq("id", bookingId);
        }
        const row = await loadToken();
        if (!row) return json({ ok: true, connected: false });
        // Never swallow this. A malformed select fails here rather than at
        // Google, and reporting it as "no such booking" is what hid a broken
        // column name through every push this function has ever done.
        const { data: rows, error: qErr } = await q;
        if (qErr) {
          await noteError(qErr.message);
          console.error("[google-calendar] booking query failed", qErr);
          return json({ ok: false, error: qErr.message, soft: true });
        }
        const list = rows ?? [];
        if (!list.length) return json({ ok: false, error: "no such booking" }, 404);

        try {
          // One access token for the whole series — it is good for an hour and
          // minting one per session would be 52 pointless calls to Google.
          const token = await accessToken(row.refresh_token, clientId, clientSecret);
          const cal = encodeURIComponent(row.calendar_id || "primary");
          const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
          const wanted = action === "push" || action === "push-series";
          let written = 0, removed = 0;

          for (const bk of list) {
            // A cancelled row never has an event, whichever action asked.
            if (!wanted || bk.status !== "booked") {
              if (await dropEvent(bk, cal, auth)) removed++;
              continue;
            }
            await writeEvent(bk, cal, auth);
            written++;
          }
          await sb.from("google_calendar").update({ last_error: null }).eq("coach_id", coachId);
          return json({ ok: true, written, removed });
        } catch (e) {
          await noteError(String(e));
          // The bookings themselves already succeeded in our database. Google
          // failing is a sync problem, not a booking problem, and must never
          // roll the booking back. A series that fails halfway leaves the
          // events it did write; re-running the same push finds them by
          // google_event_id and patches instead of duplicating.
          console.error("[google-calendar] push failed", e);
          return json({ ok: false, error: String(e), soft: true });
        }
      }

      // Every future booking that has no event yet. The targeted pushes above
      // all fire at the moment a booking is MADE, so anything that already
      // existed when Google was connected has nothing pointing at it and never
      // appears — which, after a Setmore cut-over, is the entire schedule.
      //
      // Done in batches the caller loops over rather than in one pass: several
      // hundred bookings is several hundred sequential Google calls, which
      // would outrun the function's wall clock and leave the coach staring at a
      // spinner with no idea how far it got. Each call reports what remains, so
      // the UI can count down and a failure only costs one batch.
      case "push-all": {
        const row = await loadToken();
        if (!row) return json({ ok: true, connected: false });
        const size = Math.max(1, Math.min(50, Number(body?.batch ?? 25)));
        const from = String(body?.from ?? new Date().toISOString());
        const pending = () => sb.from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("coach_id", coachId).eq("status", "booked")
          .is("google_event_id", null).gte("start_at", from);
        // Cancelled, but the event is still on the calendar. This repair used to
        // be push-only, so it could not fix a cancellation at all — and a
        // cancellation is the half that goes wrong most, because `remove` fires
        // once, at the moment of cancelling, and is never retried. Cancel while
        // the grant is dead (or the network is out) and the session sits on the
        // coach's calendar forever, looking like a real appointment.
        // Found 2026-08-17: seven of them, one still upcoming.
        const orphans = () => sb.from("bookings")
          .select("id, google_event_id, status")
          .eq("coach_id", coachId).neq("status", "booked")
          .not("google_event_id", "is", null);

        const { data: rows, error: qErr } = await sb.from("bookings").select("*, athletes(display_name)")
          .eq("coach_id", coachId).eq("status", "booked")
          .is("google_event_id", null).gte("start_at", from)
          .order("start_at", { ascending: true }).limit(size);
        if (qErr) {
          await noteError(qErr.message);
          console.error("[google-calendar] backfill query failed", qErr);
          return json({ ok: false, error: qErr.message, soft: true });
        }
        const list = rows ?? [];
        const { data: ghostRows } = await orphans();
        const ghosts = ghostRows ?? [];
        if (!list.length && !ghosts.length) {
          return json({ ok: true, written: 0, removed: 0, remaining: 0, done: true });
        }

        try {
          const token = await accessToken(row.refresh_token, clientId, clientSecret);
          const cal = encodeURIComponent(row.calendar_id || "primary");
          const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
          let written = 0, removed = 0;
          // Cancellations first: taking a session OFF the calendar matters more
          // than adding one, because a ghost appointment is read as real and
          // planned around, while a missing one is at worst noticed.
          try {
            for (const bk of ghosts.slice(0, size)) {
              if (await dropEvent(bk, cal, auth)) removed++;
              await sleep(120);
            }
          } catch (e) {
            await noteError(String(e));
            const { count } = await pending();
            console.error("[google-calendar] push-all cancel sweep stopped", e);
            return json({ ok: false, error: String(e), soft: true, written: 0, removed, remaining: count ?? 0 });
          }
          try {
            for (const bk of list) {
              await writeEvent(bk, cal, auth);
              written++;
              // Paced deliberately. The retry in writeEvent recovers from a
              // limit once it is hit; this is what keeps it from being hit.
              await sleep(120);
            }
          } catch (e) {
            // Report what this batch DID write. Everything written is already
            // recorded against its booking, so the caller can simply run again
            // and resume — but only if it can see progress was made, or it will
            // read a partial success as a dead stop.
            await noteError(String(e));
            const { count } = await pending();
            console.error("[google-calendar] push-all batch stopped", e);
            return json({ ok: false, error: String(e), soft: true, written, removed, remaining: count ?? 0 });
          }
          await sb.from("google_calendar").update({ last_error: null }).eq("coach_id", coachId);
          const { count } = await pending();
          // Not done while ghosts remain: a caller that stopped on remaining===0
          // would leave cancelled sessions on the calendar past the first batch.
          const { data: left } = await orphans();
          const ghostsLeft = (left ?? []).length;
          return json({ ok: true, written, removed, remaining: (count ?? 0) + ghostsLeft,
            done: (count ?? 0) === 0 && ghostsLeft === 0 });
        } catch (e) {
          await noteError(String(e));
          const { count } = await pending();
          console.error("[google-calendar] push-all failed", e);
          return json({ ok: false, error: String(e), soft: true, written: 0, removed: 0, remaining: count ?? 0 });
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
