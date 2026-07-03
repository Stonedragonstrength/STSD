// Pulls each coach's Setmore iCal feed (coaches.setmore_ics_url) and upserts
// events into setmore_events. Invoked on a schedule (see the pg_cron
// migration) and also on-demand from the app's "Refresh now" button.
//
// Uses the service role key (auto-injected by Supabase into every Edge
// Function — no secret to set) since this reads a sensitive column
// (setmore_ics_url) that the app's anon-key client never touches directly.

import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (_req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceRoleKey);

    const { data: coaches, error: coachErr } = await sb
      .from("coaches")
      .select("id, setmore_ics_url")
      .not("setmore_ics_url", "is", null);
    if (coachErr) throw coachErr;

    const results = [];
    for (const coach of coaches ?? []) {
      if (!coach.setmore_ics_url) continue;
      try {
        results.push(await syncCoach(sb, coach.id, coach.setmore_ics_url));
      } catch (e) {
        console.error(`[sync-setmore] coach ${coach.id} failed:`, e);
        results.push({ coachId: coach.id, error: String(e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[sync-setmore] fatal:", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

async function syncCoach(sb: any, coachId: string, icsUrl: string) {
  const syncStartedAt = new Date().toISOString();
  // Setmore's feed filters by User-Agent (not real bearer auth, despite the
  // misleading 401 message) — it 401s a bare script fetch but 200s a request
  // that looks like a calendar client subscribing to it.
  const res = await fetch(icsUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Google-Calendar-Importer)" },
  });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const text = await res.text();
  const events = parseIcs(text);

  if (events.length) {
    const rows = events.map((e) => ({
      coach_id: coachId,
      external_uid: e.uid,
      client_name: guessClientName(e),
      title: e.summary || null,
      start_at: e.start,
      end_at: e.end,
      raw: e,
      synced_at: syncStartedAt,
    }));
    const { error } = await sb
      .from("setmore_events")
      .upsert(rows, { onConflict: "coach_id,external_uid" });
    if (error) throw error;
  }

  // Anything not touched by this sync is no longer in the feed (cancelled/moved).
  const { error: delErr } = await sb
    .from("setmore_events")
    .delete()
    .eq("coach_id", coachId)
    .lt("synced_at", syncStartedAt);
  if (delErr) throw delErr;

  return { coachId, count: events.length };
}

type IcsEvent = {
  uid: string;
  summary?: string;
  description?: string;
  location?: string;
  start: string;
  end?: string;
};

function parseIcs(text: string): IcsEvent[] {
  // Unfold continuation lines (RFC 5545: a line starting with a space/tab
  // is a continuation of the previous line).
  const unfolded = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r\n|\n/);
  const events: Partial<IcsEvent>[] = [];
  let cur: Partial<IcsEvent> | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const rawKey = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = rawKey.split(";")[0];
    if (key === "UID") cur.uid = value;
    else if (key === "SUMMARY") cur.summary = unescapeIcsText(value);
    else if (key === "DESCRIPTION") cur.description = unescapeIcsText(value);
    else if (key === "LOCATION") cur.location = unescapeIcsText(value);
    else if (key === "DTSTART") cur.start = parseIcsDate(rawKey, value) ?? undefined;
    else if (key === "DTEND") cur.end = parseIcsDate(rawKey, value) ?? undefined;
  }
  return events.filter((e): e is IcsEvent => !!e.uid && !!e.start);
}

function unescapeIcsText(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

// Handles the common shapes: UTC ("...T...Z"), floating/local ("...T...",
// treated as UTC — good enough for a v1 single-timezone coach), and
// all-day (";VALUE=DATE:YYYYMMDD").
function parseIcsDate(rawKey: string, value: string): string | null {
  if (rawKey.includes("VALUE=DATE") && !rawKey.includes("VALUE=DATE-TIME")) {
    const y = value.slice(0, 4), m = value.slice(4, 6), d = value.slice(6, 8);
    return `${y}-${m}-${d}T00:00:00Z`;
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
}

// Setmore's DESCRIPTION includes a reliable "Customer - <name>" line, e.g.:
//   Service Name: 80\nProvider - Nathan Misura\nCustomer - Matthew Gerrish\n
// Fall back to the SUMMARY shape ("<name> for <service>") if that's missing.
function guessClientName(e: { summary?: string; description?: string }): string | null {
  const fromDescription = e.description?.match(/Customer\s*-\s*(.+)/i);
  if (fromDescription) return fromDescription[1].trim();
  if (!e.summary) return null;
  const forMatch = e.summary.match(/^(.+?)\s+for\s+/i);
  if (forMatch) return forMatch[1].trim();
  return e.summary.trim();
}
