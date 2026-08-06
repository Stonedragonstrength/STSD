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
//   config          -> { configured, mode, missing }
//   chargeMonth     -> { url }  a Square-hosted page to pay ONE month's amount,
//                     or with noLink:true an invoice raised with no link at all
//   markInvoicePaid -> tick off a no-link invoice paid in cash
//   voidCharge      -> forget a link that was sent by mistake
//
// WHY THIS IS NOT A SUBSCRIPTION
// The first version of this file created Square subscription plans. That was
// wrong for this business. Nathan bills by the SESSION: the count moves month
// to month (an athlete on an 8-session membership who trains 9 times is charged
// for 9), and discounts happen. A subscription charges a fixed amount on a
// fixed cadence, so every single month would have needed a manual correction
// next to it — and the coach would have been maintaining Square catalog objects
// to describe prices he doesn't actually charge.
//
// So a charge is one month, for whatever the amount really is. The app already
// computes it (sessions × rate, the same arithmetic the income card uses) and
// the coach adjusts it before sending. No plans, no catalog ids, no mapping.
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
//   2. supabase secrets set \
//        SQUARE_ACCESS_TOKEN=... SQUARE_LOCATION_ID=... SQUARE_ENV=sandbox
//   3. supabase functions deploy square-billing --use-api --no-verify-jwt
//
// That is the whole setup. Nothing to create in the Square dashboard, no plans,
// no catalog ids to copy — deliberately, because the previous design needed all
// three and none of them matched how the money actually works.
//
// Until those secrets exist every action returns { ok:false, needsSetup:true }
// and the app shows billing as not set up. Nothing an athlete sees changes.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callerUserId } from "../_shared/caller-auth.ts";

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
    // Square's `detail` alone is often unactionable — "This request could not
    // be authorized" is the same sentence for a bad token, a sandbox token sent
    // to production, and a token missing a permission. The CODE distinguishes
    // them, so carry it.
    const e0 = body?.errors?.[0];
    const detail = e0?.detail ?? `square ${res.status}`;
    const code = e0?.code ? ` [${e0.category ?? "?"}/${e0.code}]` : ` [HTTP ${res.status}]`;
    throw new Error(detail + code);
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

  // Which build is live, and what the auth-related env actually looks like.
  // Answered BEFORE the auth check on purpose — when auth is the thing that's
  // broken, a diagnostic behind it tells you nothing. Exposes no secret: only
  // the SHAPE of the keys (length and prefix), which is what distinguishes a
  // project JWT from the new sb_secret_/sb_publishable_ format.
  let peekBody: any = {};
  try { peekBody = await req.clone().json(); } catch { /* no body */ }
  if (peekBody?.action === "version") {
    const shape = (v: string | undefined) =>
      !v ? "(unset)" : `${v.slice(0, 11)}… len=${v.length} ${v.startsWith("ey") ? "JWT" : "NOT-JWT"}`;
    return json({
      ok: true,
      build: "2026-08-06-auth-via-service-getUser",
      anonKey: shape(Deno.env.get("SUPABASE_ANON_KEY")),
      serviceKey: shape(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")),
      url: Deno.env.get("SUPABASE_URL") ?? "(unset)",
    });
  }

  // ---- Who is asking? ----
  // Via GoTrue over HTTP, not a client built from SUPABASE_ANON_KEY — that key
  // is managed by Supabase and stopped being a JWT when the project moved to
  // the new key format, which silently 401'd every caller holding a perfectly
  // valid session. See _shared/caller-auth.ts for the whole story.
  const sb = createClient(supabaseUrl, serviceKey);
  const userId = await callerUserId(req, supabaseUrl);
  if (!userId) return json({ ok: false, error: "not signed in" }, 401);
  // library_prefs carries the invoice issuer details (invoiceFrom), read here
  // rather than accepted from the caller: it is the coach's own data either
  // way, but read server-side there is exactly one copy of it and no way for a
  // stale browser to stamp an old address onto a new invoice.
  // NOTE the column names: `coaches` has display_name and NOT name. PostgREST
  // 400s the WHOLE select on one unknown column, and this caller destructures
  // only `data` — so a wrong name here reads as "you are not a coach".
  const { data: coach } = await sb.from("coaches")
    .select("id, display_name, email, library_prefs").eq("auth_user_id", userId).maybeSingle();
  if (!coach) return json({ ok: false, error: "coach only" }, 403);
  const coachId = coach.id as string;

  // Legacy fallback only. The tier -> variation mapping now lives on the
  // coach's own row (library_prefs.squarePlans) and is set from a dropdown,
  // because there is no way to look a variation id up by hand. Kept so an
  // install already carrying the secret doesn't break.
  let secretPlans: Record<string, string> = {};
  try { secretPlans = plansRaw ? JSON.parse(plansRaw) : {}; } catch { secretPlans = {}; }

  // Named individually: these are matched EXACTLY, and getting one name wrong
  // in the dashboard looks identical to not having set it at all.
  const missing = [
    token ? null : "SQUARE_ACCESS_TOKEN",
    locationId ? null : "SQUARE_LOCATION_ID",
  ].filter(Boolean);

  let body: any = {};
  try { body = await req.json(); } catch { /* config takes no body */ }
  const action = body?.action ?? "config";

  if (action === "config") {
    return json({
      ok: true,
      configured: missing.length === 0,
      mode: (Deno.env.get("SQUARE_ENV") ?? "sandbox").toLowerCase(),
      missing,
    });
  }

  // Only the actions that actually talk to Square need Square. An invoice with
  // no payment link, and the coach ticking one off as paid in cash, are this
  // app's own business — gating them on a token would mean a rotated key takes
  // the paper side of the books down with the card side.
  const needsSquare = !(action === "markInvoicePaid" ||
    (action === "chargeMonth" && body?.noLink === true));
  if (needsSquare && missing.length) {
    return json({ ok: false, error: "not configured", needsSetup: true, missing });
  }

  try {
    // ---- Is the token actually usable, and does the location match? ----
    // "This request could not be authorized" is the same sentence for a bad
    // token, a sandbox token pointed at production, and a token missing a
    // permission. This calls the most harmless endpoint there is and reports
    // what came back, so those three stop looking identical.
    if (action === "ping") {
      const out: Record<string, unknown> = {
        env: (Deno.env.get("SQUARE_ENV") ?? "sandbox").toLowerCase(),
        base: squareBase(),
        // Shape only — never the value. A token pasted with a trailing newline
        // or truncated mid-copy shows up here as a wrong length or a bad prefix.
        tokenLen: token.length,
        tokenPrefix: token.slice(0, 4),
        tokenLooksSandbox: token.startsWith("EAAAl") || token.includes("-sandbox"),
        tokenHasWhitespace: /\s/.test(token),
        locationIdGiven: locationId,
      };
      try {
        const locs = await square("/v2/locations", token);
        const list = (locs?.locations ?? []).map((l: any) => ({ id: l.id, name: l.name }));
        out.ok = true;
        out.locations = list;
        out.locationMatches = list.some((l: any) => l.id === locationId);
      } catch (e) {
        out.ok = false;
        out.squareSaid = (e as Error).message;
      }
      return json(out);
    }

    // ---- Charge one month ----
    // The amount comes from the coach, not from a plan, because the coach is
    // the one who knows it: sessions × rate, plus or minus whatever this month
    // actually was. A coach setting a price for their own athlete is not a
    // threat model — they set every price in this app — so this validates that
    // the athlete is theirs and that the number is sane, and trusts the rest.
    if (action === "chargeMonth") {
      const athleteId = String(body?.athleteId ?? "");
      const monthKey = String(body?.monthKey ?? "");
      const amountCents = Math.round(Number(body?.amountCents));
      const sessions = Number.isFinite(Number(body?.sessions)) ? Number(body.sessions) : null;
      const note = String(body?.note ?? "").slice(0, 120);
      const rate = Number.isFinite(Number(body?.rate)) ? Number(body.rate) : null;
      // An invoice with no payment link, for the athletes who hand over cash or
      // send a transfer. Same document, same numbering, same place in the books
      // — the only difference is who is allowed to say it has been paid.
      const noLink = body?.noLink === true;
      if (!athleteId || !/^\d{4}-\d{2}$/.test(monthKey)) {
        return json({ ok: false, error: "athleteId and a YYYY-MM monthKey are required" });
      }
      // A ceiling, not a price check. It exists so an arithmetic slip upstream
      // cannot put a five-figure link in front of somebody.
      if (!Number.isFinite(amountCents) || amountCents < 100 || amountCents > 1000000) {
        return json({ ok: false, error: "Amount must be between $1 and $10,000" });
      }

      // NOTE the column list: `athletes` has display_name and NOT name, and no
      // email column at all. PostgREST 400s the WHOLE select on one unknown
      // column, and a caller that destructures only `data` throws that error
      // away and silently matches nothing.
      const { data: athlete } = await sb.from("athletes")
        .select("id, display_name, coach_id, partner_id, auth_user_id")
        .eq("id", athleteId).maybeSingle();
      if (!athlete || athlete.coach_id !== coachId) return json({ ok: false, error: "not your athlete" }, 403);

      // The athlete's email is their Supabase Auth login, not a column on the
      // row. Only used to pre-fill Square's page, so a missing one is fine.
      let email: string | undefined;
      if (athlete.auth_user_id) {
        const { data: au } = await sb.auth.admin.getUserById(athlete.auth_user_id);
        email = au?.user?.email ?? undefined;
      }

      // One unpaid link per athlete per month. Sending a second one otherwise
      // leaves two live links for the same month, and if both get paid, two
      // charges — so any earlier unpaid one is voided first.
      await sb.from("billing_payments")
        .update({ status: "canceled" })
        .eq("athlete_id", athleteId).eq("month_key", monthKey).eq("status", "sent");

      let url: string | null = null;
      let orderId: string | null = null;
      if (!noLink) {
        const link = await square("/v2/online-checkout/payment-links", token, {
          method: "POST",
          body: JSON.stringify({
            idempotency_key: `chg-${athleteId}-${monthKey}-${Date.now()}`,
            quick_pay: {
              name: note || `Training · ${monthKey}`,
              price_money: { amount: amountCents, currency: "USD" },
              location_id: locationId,
            },
            checkout_options: { ask_for_shipping_address: false },
            pre_populated_data: email ? { buyer_email: email } : undefined,
          }),
        });
        url = link?.payment_link?.url ?? link?.payment_link?.long_url ?? null;
        orderId = link?.payment_link?.order_id ?? null;
        if (!url) return json({ ok: false, error: "Square did not return a checkout link" });
      }

      // The number, and the issuer as they stand today. Taken AFTER Square has
      // agreed to make the link: a failed checkout would otherwise burn an
      // invoice number on a document that never existed, and a run with holes
      // in it is exactly what the counter is there to prevent.
      const { data: invoiceNo } = await sb.rpc("next_invoice_no", { p_coach: coachId });
      const prefs = (coach.library_prefs ?? {}) as Record<string, unknown>;
      const from = (prefs.invoiceFrom ?? {}) as Record<string, unknown>;
      const issuer = {
        businessName: String(from.businessName ?? coach.display_name ?? "").slice(0, 80),
        contact: String(from.contact ?? coach.email ?? "").slice(0, 120),
        address: String(from.address ?? "").slice(0, 200),
        taxLine: String(from.taxLine ?? "").slice(0, 80),
        footer: String(from.footer ?? "").slice(0, 200),
      };

      // Recorded as 'sent', which grants nothing and settles nothing. The order
      // id is the join: the payment webhook carries the same one, and that is
      // what turns this row into 'paid'. Without it a payment cannot be matched
      // back to a month and the settle step has nothing to work from.
      await sb.from("billing_payments").insert({
        coach_id: coachId,
        athlete_id: athleteId,
        month_key: monthKey,
        square_order_id: orderId,
        amount_cents: amountCents,
        sessions,
        // The per-session figure the total was built from, kept so the invoice
        // can show its own working instead of one unexplained number.
        rate_cents: rate == null ? null : Math.round(rate * 100),
        note: note || null,
        // Stored so the ATHLETE can pay from their own Sessions tab instead of
        // waiting to be sent it. Their select policy already scopes this row to
        // them, and the link is exactly what they're meant to have.
        checkout_url: url,
        invoice_no: invoiceNo ?? null,
        issuer,
        method: noLink ? "manual" : "card",
        status: "sent",
      });

      // Remember the athlete so their charges group together in Square's own
      // dashboard rather than reading as unrelated strangers.
      const { primary, partner } = primaryOf(athlete.id, athlete.partner_id ?? null);
      const { data: existing } = await sb.from("billing_subscriptions")
        .select("athlete_id").eq("athlete_id", primary).maybeSingle();
      if (!existing) {
        await sb.from("billing_subscriptions").upsert({
          athlete_id: primary, coach_id: coachId, partner_athlete_id: partner,
          status: "none", updated_at: new Date().toISOString(),
        }, { onConflict: "athlete_id" });
      }

      return json({ ok: true, url, orderId });
    }

    // ---- The coach ticks off an invoice he was paid in cash ----
    //
    // This is the ONE way a payment gets recorded without Square, and the guard
    // below is what keeps that from being a hole in the rule that only a
    // verified webhook may settle a card charge: a row carrying a Square order
    // id is refused outright, whoever is asking. What is left is invoices this
    // app raised with no payment link, where the only person who can possibly
    // know the money arrived is the coach who was handed it.
    //
    // The athlete cannot reach this — the caller is checked against `coaches`
    // at the top of the file, and billing_payments still has no write policy
    // for anyone.
    if (action === "markInvoicePaid") {
      const id = String(body?.id ?? "");
      const paid = body?.paid !== false; // default true; false undoes a mis-tap
      if (!id) return json({ ok: false, error: "id required" });
      const { data: row } = await sb.from("billing_payments")
        .select("id, coach_id, square_order_id, status").eq("id", id).maybeSingle();
      if (!row || row.coach_id !== coachId) return json({ ok: false, error: "not your invoice" }, 403);
      if (row.square_order_id) {
        return json({ ok: false, error: "That one is a card charge — Square confirms it, not us." });
      }
      const { error } = await sb.from("billing_payments").update({
        status: paid ? "paid" : "sent",
        paid_at: paid ? new Date().toISOString() : null,
        method: "manual",
      }).eq("id", id);
      if (error) return json({ ok: false, error: error.message });
      return json({ ok: true, paid });
    }

    // ---- Forget a link sent by mistake ----
    // Only ever touches a 'sent' row. A paid charge is a record of money that
    // moved, and is not the app's to erase.
    if (action === "voidCharge") {
      const athleteId = String(body?.athleteId ?? "");
      const monthKey = String(body?.monthKey ?? "");
      const { data: rows } = await sb.from("billing_payments")
        .select("id, coach_id").eq("athlete_id", athleteId)
        .eq("month_key", monthKey).eq("status", "sent");
      const mine = (rows ?? []).filter((r: any) => r.coach_id === coachId);
      if (!mine.length) return json({ ok: false, error: "nothing to void" });
      await sb.from("billing_payments").update({ status: "canceled" })
        .in("id", mine.map((r: any) => r.id));
      return json({ ok: true, voided: mine.length });
    }

    return json({ ok: false, error: `unknown action "${action}"` });
  } catch (e) {
    // Square's own message, surfaced — "CARD_DECLINED" or "plan not found" is
    // information the coach can act on, and hiding it behind "something went
    // wrong" costs an hour of guessing.
    return json({ ok: false, error: (e as Error).message });
  }
});
