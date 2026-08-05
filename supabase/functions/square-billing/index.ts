// Square billing — the coach-facing half. Starts checkouts; never confirms one.
//
// Reading billing state is NOT here: billing_subscriptions and billing_payments
// both have select policies for the owning athlete and their coach, so the app
// queries them straight through PostgREST. This function exists only for the
// things that need the Square access token, which can never reach a browser —
// this repo is public and every file in it ships to athletes in plaintext, the
// same reason the Google client secret and the VAPID private key live in
// function secrets.
//
// Actions (POST { action, ... }), coach only:
//   config    -> { configured, mode, plans, missing }
//   checkout  -> { url }   a Square-hosted page for the athlete to enter a card
//   cancel    -> cancel the subscription at the end of the paid period
//
// WHAT THIS FUNCTION IS NOT ALLOWED TO DO
// It does not grant sessions, clear an owed flag, or write anything the app
// treats as proof of payment. The only writes here are `pending` scaffolding
// (which athlete, which plan, which Square customer) so that the webhook has a
// row to bind an incoming subscription to. Entitlement comes from
// square-webhook, behind an HMAC check, or it does not come at all.
//
// verify_jwt is OFF and this file authenticates instead: the browser's CORS
// preflight carries no credentials, so a gateway JWT check answers it with 401
// and the real request never leaves the browser. Every call is authenticated
// below with auth.getUser + a coaches lookup, so this moves the check rather
// than removing it — same arrangement as google-calendar.
//
// Setup (one time, by the coach — none of it can be done from the app):
//   1. Square Developer dashboard -> new application. Note the Access Token
//      and Location ID for the environment you want (Sandbox first).
//   2. In the Square dashboard, create a SUBSCRIPTION PLAN for each membership
//      tier you want to bill — name, price, monthly cadence. Pricing is a
//      business decision and belongs in Square, not in this repo. Copy each
//      plan VARIATION id.
//   3. Map them to the app's tier ids (MEMBERSHIPS in app.js):
//        supabase secrets set \
//          SQUARE_ACCESS_TOKEN=... \
//          SQUARE_LOCATION_ID=... \
//          SQUARE_ENV=sandbox \
//          SQUARE_PLANS='{"single-2":"VARIATION_ID","couples-2":"VARIATION_ID"}'
//   4. supabase functions deploy square-billing --use-api --no-verify-jwt
//
// Until those secrets exist every action returns { ok:false, needsSetup:true }
// and the app shows billing as not set up. Nothing an athlete sees changes.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 200 with ok:false for every expected state. supabase-js treats any non-2xx as
// an error and throws the body away, so an explanation sent with an error
// status can never reach the UI.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });

const SQUARE_VERSION = "2025-01-23";

function squareBase(): string {
  return (Deno.env.get("SQUARE_ENV") ?? "sandbox").toLowerCase() === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

async function square(path: string, token: string, init?: RequestInit) {
  const res = await fetch(squareBase() + path, {
    ...init,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = body?.errors?.[0]?.detail ?? `square ${res.status}`;
    throw new Error(detail);
  }
  return body;
}

/**
 * A couple share one allowance and mirror packages onto each other, so they get
 * ONE subscription. Both halves must agree on which row that is without
 * coordinating, so the primary is simply the lower of the two ids — a rule each
 * side computes to the same answer on its own.
 */
function primaryOf(athleteId: string, partnerId: string | null): { primary: string; partner: string | null } {
  if (!partnerId) return { primary: athleteId, partner: null };
  return athleteId <= partnerId
    ? { primary: athleteId, partner: partnerId }
    : { primary: partnerId, partner: athleteId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = Deno.env.get("SQUARE_ACCESS_TOKEN") ?? "";
  const locationId = Deno.env.get("SQUARE_LOCATION_ID") ?? "";
  const plansRaw = Deno.env.get("SQUARE_PLANS") ?? "";

  // ---- Who is asking? ----
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ ok: false, error: "not signed in" }, 401);

  const sb = createClient(supabaseUrl, serviceKey);
  const { data: coach } = await sb.from("coaches").select("id").eq("auth_user_id", user.id).maybeSingle();
  if (!coach) return json({ ok: false, error: "coach only" }, 403);
  const coachId = coach.id as string;

  let plans: Record<string, string> = {};
  try { plans = plansRaw ? JSON.parse(plansRaw) : {}; } catch { plans = {}; }

  // Named individually: these are matched EXACTLY, and getting one name wrong
  // in the dashboard looks identical to not having set it at all.
  const missing = [
    token ? null : "SQUARE_ACCESS_TOKEN",
    locationId ? null : "SQUARE_LOCATION_ID",
    Object.keys(plans).length ? null : "SQUARE_PLANS",
  ].filter(Boolean);

  let body: any = {};
  try { body = await req.json(); } catch { /* config takes no body */ }
  const action = body?.action ?? "config";

  if (action === "config") {
    return json({
      ok: true,
      configured: missing.length === 0,
      mode: (Deno.env.get("SQUARE_ENV") ?? "sandbox").toLowerCase(),
      plans: Object.keys(plans),
      missing,
    });
  }

  if (missing.length) return json({ ok: false, error: "not configured", needsSetup: true, missing });

  try {
    // ---- Start a checkout ----
    if (action === "checkout") {
      const athleteId = String(body?.athleteId ?? "");
      const planKey = String(body?.planKey ?? "");
      if (!athleteId || !planKey) return json({ ok: false, error: "athleteId and planKey required" });
      const variationId = plans[planKey];
      if (!variationId) {
        return json({ ok: false, error: `No Square plan mapped for "${planKey}". Add it to SQUARE_PLANS.` });
      }

      // The athlete must be THIS coach's, checked server-side. A coach id from
      // the JWT plus an athlete id from the body is only safe if the two are
      // verified to belong together.
      //
      // NOTE the column list: `athletes` has display_name and NOT name, and no
      // email column at all. PostgREST 400s the WHOLE select on one unknown
      // column, and callers that destructure only `data` throw that error away
      // and silently match nothing — which is how google-calendar's push came
      // to quietly do nothing for a while. Don't add a column here without
      // checking it exists.
      const { data: athlete } = await sb.from("athletes")
        .select("id, display_name, coach_id, partner_id, auth_user_id")
        .eq("id", athleteId).maybeSingle();
      if (!athlete || athlete.coach_id !== coachId) return json({ ok: false, error: "not your athlete" }, 403);

      // The athlete's email is their Supabase Auth login, not a column on the
      // row. Only used to pre-fill the Square checkout, so a missing one is
      // fine — they type it themselves.
      let email: string | undefined;
      if (athlete.auth_user_id) {
        const { data: au } = await sb.auth.admin.getUserById(athlete.auth_user_id);
        email = au?.user?.email ?? undefined;
      }

      const { primary, partner } = primaryOf(athlete.id, athlete.partner_id ?? null);

      // Reuse the Square customer if this bank already has one, so a re-run
      // doesn't leave duplicate customers behind in the dashboard.
      const { data: existing } = await sb.from("billing_subscriptions")
        .select("*").eq("athlete_id", primary).maybeSingle();

      let customerId: string | null = existing?.square_customer_id ?? null;
      if (!customerId) {
        const created = await square("/v2/customers", token, {
          method: "POST",
          body: JSON.stringify({
            idempotency_key: `cust-${primary}-${Date.now()}`,
            given_name: (athlete.display_name ?? "Athlete").slice(0, 60),
            email_address: email,
            // So the Square dashboard shows who this is without a lookup.
            reference_id: primary,
          }),
        });
        customerId = created?.customer?.id ?? null;
        if (!customerId) return json({ ok: false, error: "Square did not return a customer" });
      }

      const link = await square("/v2/online-checkout/payment-links", token, {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: `link-${primary}-${planKey}-${Date.now()}`,
          quick_pay: {
            name: `Membership · ${planKey}`,
            // Square bills the amount off the PLAN, not off this. quick_pay is
            // the container the link needs; the subscription_plan_id below is
            // what actually decides what gets charged and how often.
            price_money: { amount: 0, currency: "USD" },
            location_id: locationId,
          },
          checkout_options: {
            subscription_plan_id: variationId,
            ask_for_shipping_address: false,
          },
          pre_populated_data: email ? { buyer_email: email } : undefined,
        }),
      });
      const url = link?.payment_link?.url ?? link?.payment_link?.long_url ?? null;
      if (!url) return json({ ok: false, error: "Square did not return a checkout link" });

      // Scaffolding only — status 'pending' grants nothing. Its job is to give
      // the webhook a row to bind the real subscription to when it is created,
      // which is why square_customer_id matters more here than anything else.
      await sb.from("billing_subscriptions").upsert({
        athlete_id: primary,
        coach_id: coachId,
        partner_athlete_id: partner,
        plan_key: planKey,
        square_customer_id: customerId,
        status: existing?.status === "active" ? existing.status : "pending",
        updated_at: new Date().toISOString(),
      }, { onConflict: "athlete_id" });

      return json({ ok: true, url });
    }

    // ---- Cancel ----
    if (action === "cancel") {
      const athleteId = String(body?.athleteId ?? "");
      const { data: row } = await sb.from("billing_subscriptions")
        .select("*").eq("athlete_id", athleteId).maybeSingle();
      if (!row || row.coach_id !== coachId) return json({ ok: false, error: "not your athlete" }, 403);
      if (!row.square_subscription_id) return json({ ok: false, error: "nothing to cancel" });

      // Square's cancel ends the subscription at the end of the period already
      // paid for. The row is NOT set to canceled here: the webhook will say so,
      // and payment state having exactly one author is the point.
      await square(`/v2/subscriptions/${row.square_subscription_id}/cancel`, token, { method: "POST" });
      return json({ ok: true });
    }

    return json({ ok: false, error: `unknown action "${action}"` });
  } catch (e) {
    // Square's own message, surfaced — "CARD_DECLINED" or "plan not found" is
    // information the coach can act on, and hiding it behind "something went
    // wrong" costs an hour of guessing.
    return json({ ok: false, error: (e as Error).message });
  }
});
