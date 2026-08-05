// Daily safety net: ask Square what it thinks, and fix any drift.
//
// Webhooks get lost. Square gives up retrying eventually, a deploy can land
// mid-delivery, and a signature-key rotation silently rejects everything until
// the secret is updated. Any of those leaves this app's idea of who is paying
// frozen at whatever it last heard — and because payment state gates next
// month's grant, frozen state quietly becomes a wrong decision about somebody's
// sessions.
//
// So Square is the authority and this pulls from it once a day. Anything the
// webhook missed is corrected here within 24 hours, and the failure mode of a
// broken webhook drops from "wrong forever, silently" to "a day late".
//
// Deliberately narrow: it only ever reconciles subscriptions this app already
// knows about, and it never creates or cancels anything in Square. A
// subscription in Square with no row here is REPORTED, not adopted — guessing
// which athlete a stranger's card belongs to is exactly the kind of helpfulness
// that ends up billing the wrong person.
//
// Deploy: supabase functions deploy square-reconcile --use-api
// Schedule: see the pg_cron entry in the billing migration.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { isServiceRoleCaller } from "../_shared/cron-auth.ts";

const SQUARE_VERSION = "2025-01-23";

const STATUS_MAP: Record<string, string> = {
  ACTIVE: "active",
  PENDING: "pending",
  PAUSED: "paused",
  DEACTIVATED: "canceled",
  CANCELED: "canceled",
};

Deno.serve(async (req) => {
  // Called only by pg_cron with the service-role JWT. Identity comes from the
  // token's CLAIMS rather than its bytes, so key rotation can't silently kill
  // the schedule — see _shared/cron-auth.ts for the full story.
  if (!isServiceRoleCaller(req.headers.get("Authorization"))) {
    return new Response("forbidden", { status: 403 });
  }

  const token = Deno.env.get("SQUARE_ACCESS_TOKEN") ?? "";
  if (!token) {
    // Not an error: billing simply isn't set up yet. A 200 keeps the cron log
    // clean so a real failure stands out in it later.
    return new Response(JSON.stringify({ ok: true, skipped: "not configured" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  const base = (Deno.env.get("SQUARE_ENV") ?? "sandbox").toLowerCase() === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: rows, error } = await sb.from("billing_subscriptions")
    .select("athlete_id, status, square_subscription_id, past_due_since, current_period_end")
    .not("square_subscription_id", "is", null);
  if (error) return new Response(error.message, { status: 500 });

  let checked = 0, corrected = 0, gone = 0;

  for (const row of rows ?? []) {
    checked++;
    let sub: any = null;
    try {
      const res = await fetch(`${base}/v2/subscriptions/${row.square_subscription_id}`, {
        headers: { "Authorization": `Bearer ${token}`, "Square-Version": SQUARE_VERSION },
      });
      if (res.status === 404) {
        // Deleted in Square. Recorded as canceled rather than removed, so the
        // history of what someone was on doesn't vanish from the coach's view.
        gone++;
        await sb.from("billing_subscriptions").update({
          status: "canceled", canceled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("athlete_id", row.athlete_id);
        continue;
      }
      if (!res.ok) continue; // transient — try again tomorrow
      sub = (await res.json())?.subscription ?? null;
    } catch (e) {
      console.warn("[square-reconcile] fetch failed", row.athlete_id, (e as Error).message);
      continue;
    }
    if (!sub) continue;

    const mapped = STATUS_MAP[String(sub.status ?? "").toUpperCase()];
    if (!mapped) continue; // a status we don't model — leave it alone

    const patch: Record<string, unknown> = {};
    if (mapped !== row.status) {
      patch.status = mapped;
      if (mapped === "active") patch.past_due_since = null;
      if (mapped === "canceled" ) patch.canceled_at = new Date().toISOString();
      // Drifting INTO past_due without a webhook means we never started the
      // grace clock; start it now rather than leaving it null, which the grant
      // gate would read as "no grace used yet, forever".
      if (mapped === "past_due" && !row.past_due_since) patch.past_due_since = new Date().toISOString();
    }
    if (sub.charged_through_date && sub.charged_through_date !== row.current_period_end) {
      patch.current_period_end = sub.charged_through_date;
    }
    if (Object.keys(patch).length) {
      corrected++;
      patch.updated_at = new Date().toISOString();
      await sb.from("billing_subscriptions").update(patch).eq("athlete_id", row.athlete_id);
    }
  }

  const summary = { ok: true, checked, corrected, gone };
  // Logged as well as returned: pg_cron records that the POST succeeded, not
  // what it said, so the only durable trace of a drift being fixed is here.
  if (corrected || gone) console.log("[square-reconcile]", JSON.stringify(summary));
  return new Response(JSON.stringify(summary), { headers: { "Content-Type": "application/json" } });
});
