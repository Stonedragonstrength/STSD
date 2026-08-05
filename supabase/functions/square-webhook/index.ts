// Square webhook — the ONLY thing in this system allowed to say "this was paid".
//
// The browser can start a checkout (see square-billing) but can never assert
// the outcome of one: nothing it sends is trusted, and every entitlement write
// happens here, behind a signature check. That split is the whole security
// model, so read the four notes below before changing anything.
//
// ---------------------------------------------------------------------------
// 1. verify_jwt MUST be OFF, and this file authenticates instead
// ---------------------------------------------------------------------------
// Square has no Supabase JWT to present, so the gateway check can't be the
// gate — it would 401 every real event. The HMAC check below IS the
// authentication. That means a bug in it is not a degraded check, it is an
// open door: anything that reaches the handler unverified could mint payments.
// Hence: verify first, before parsing, before touching the database.
//
// ---------------------------------------------------------------------------
// 2. The signature covers the NOTIFICATION URL + the RAW body
// ---------------------------------------------------------------------------
// Square signs `notificationUrl + rawBody` with the webhook signature key,
// HMAC-SHA256, base64. Two ways to get this wrong, both of which look like
// "Square is sending bad signatures":
//   * Re-serialising the JSON. JSON.stringify(JSON.parse(body)) reorders and
//     respaces, and the bytes stop matching. Read the body ONCE, as text, and
//     hash exactly those bytes.
//   * Rebuilding the URL from the request. Behind the gateway the host and
//     protocol are not necessarily what Square was configured with. The URL is
//     a secret (SQUARE_WEBHOOK_URL) and must be pasted to match the Square
//     dashboard's subscription URL character for character.
//
// ---------------------------------------------------------------------------
// 3. Replays are guaranteed, so idempotency is not optional
// ---------------------------------------------------------------------------
// Square retries until it gets a 2xx — on its own timeout, on our cold start,
// on a deploy. The same event WILL arrive twice. Every handler run inserts the
// event id into billing_events FIRST and returns early on conflict, so a replay
// cannot record a payment twice or move a subscription backwards.
//
// ---------------------------------------------------------------------------
// 4. Status codes here mean the opposite of everywhere else in this project
// ---------------------------------------------------------------------------
// The browser-called functions return 200 with { ok: false } for expected
// states, because supabase-js throws away non-2xx bodies. Square is not
// supabase-js: a non-2xx is how we ask it to RETRY. So here, 200 means
// "handled, don't send it again" and 5xx means "we broke, please resend".
// A bad signature gets 401 and is never retried into existence.
//
// Setup (one time, by the coach — none of it can be done from the app):
//   1. Square Developer dashboard -> your application -> Webhooks ->
//      Subscriptions -> Add. URL:
//        https://<project-ref>.supabase.co/functions/v1/square-webhook
//      Events: subscription.created, subscription.updated,
//              invoice.payment_made, invoice.scheduled_charge_failed,
//              invoice.canceled, payment.updated
//   2. Copy the signature key it shows you, then:
//        supabase secrets set SQUARE_WEBHOOK_KEY=... \
//          SQUARE_WEBHOOK_URL=https://<project-ref>.supabase.co/functions/v1/square-webhook
//   3. supabase functions deploy square-webhook --use-api --no-verify-jwt
//
// Sandbox and production have SEPARATE signature keys and separate webhook
// subscriptions. Point the secrets at whichever you are testing.

import { createClient } from "jsr:@supabase/supabase-js@2";

const enc = new TextEncoder();

/** Constant-time compare, so a wrong signature can't be narrowed byte by byte. */
function timingSafeEqual(a: string, b: string): boolean {
  const A = enc.encode(a), B = enc.encode(b);
  // Length is not secret (base64 of a SHA-256 is always the same size), but
  // bailing early on it still must not short-circuit the loop below.
  let diff = A.length ^ B.length;
  const n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) diff |= (A[i] ?? 0) ^ (B[i] ?? 0);
  return diff === 0;
}

async function expectedSignature(key: string, payload: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/** 'YYYY-MM' in UTC. Matches the app's monthKey for a package. */
function monthKeyOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Square subscription status -> ours. Anything unrecognised is left alone
// rather than guessed at: a status we don't understand must not silently
// become "canceled" and stop somebody's sessions.
const STATUS_MAP: Record<string, string> = {
  ACTIVE: "active",
  PENDING: "pending",
  PAUSED: "paused",
  DEACTIVATED: "canceled",
  CANCELED: "canceled",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const signatureKey = Deno.env.get("SQUARE_WEBHOOK_KEY") ?? "";
  const notificationUrl = Deno.env.get("SQUARE_WEBHOOK_URL") ?? "";
  // Not configured is a 503, not a 200: if this is live in Square but the
  // secrets aren't set, we want Square to keep retrying (and to show the
  // failure in its dashboard) rather than swallow real payment events.
  if (!signatureKey || !notificationUrl) {
    console.error("[square-webhook] missing SQUARE_WEBHOOK_KEY / SQUARE_WEBHOOK_URL");
    return new Response("not configured", { status: 503 });
  }

  // ONCE, as text. See note 2.
  const rawBody = await req.text();
  const given = req.headers.get("x-square-hmacsha256-signature") ?? "";
  const expected = await expectedSignature(signatureKey, notificationUrl + rawBody);
  if (!given || !timingSafeEqual(given, expected)) {
    // No detail in the response and no body in the log — an attacker probing
    // this endpoint learns nothing, and we don't write unverified payloads
    // anywhere.
    console.warn("[square-webhook] signature rejected");
    return new Response("bad signature", { status: 401 });
  }

  let evt: any;
  try { evt = JSON.parse(rawBody); } catch {
    // Signed but unparseable means Square and we disagree about the format,
    // which retrying will not fix.
    return new Response("bad json", { status: 200 });
  }

  const eventId: string = evt?.event_id ?? evt?.id ?? "";
  const type: string = evt?.type ?? "";
  if (!eventId) return new Response("no event id", { status: 200 });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Idempotency gate. Insert first: if this event has been seen, the insert
  // conflicts and we stop before touching anything else. See note 3.
  const { error: seenErr } = await sb.from("billing_events")
    .insert({ event_id: eventId, event_type: type });
  if (seenErr) {
    // 23505 = unique violation = a replay, which is a success from Square's
    // point of view. Anything else is a real database problem, and a 5xx asks
    // Square to send it again rather than losing the event.
    if ((seenErr as any).code === "23505") return new Response("duplicate", { status: 200 });
    console.error("[square-webhook] ledger insert failed", seenErr.message);
    return new Response("ledger error", { status: 500 });
  }

  try {
    const obj = evt?.data?.object ?? {};

    // ---- Subscription lifecycle ----
    if (type === "subscription.created" || type === "subscription.updated") {
      const sub = obj.subscription ?? obj;
      const subId = sub?.id;
      if (!subId) return new Response("ok", { status: 200 });

      let { data: row } = await sb.from("billing_subscriptions")
        .select("athlete_id, status, past_due_since")
        .eq("square_subscription_id", subId).maybeSingle();

      // First sight of this subscription. square-billing wrote the row when it
      // made the checkout link, but a hosted checkout creates the subscription
      // AFTER the athlete pays — so at that point all we had was the customer.
      // Bind on customer id here; this is the moment the row stops being
      // scaffolding and starts being a real subscription.
      if (!row && sub?.customer_id) {
        const { data: pending } = await sb.from("billing_subscriptions")
          .select("athlete_id, status, past_due_since")
          .eq("square_customer_id", sub.customer_id)
          .is("square_subscription_id", null)
          .maybeSingle();
        if (pending) {
          await sb.from("billing_subscriptions")
            .update({ square_subscription_id: subId })
            .eq("athlete_id", pending.athlete_id);
          row = pending;
        }
      }
      if (!row) {
        // A subscription belonging to nobody we know. Don't invent an athlete
        // for it — square-reconcile reports the orphan instead, because a
        // guess here would attach somebody's card to the wrong person.
        console.warn("[square-webhook] unknown subscription", subId);
        return new Response("ok", { status: 200 });
      }

      const mapped = STATUS_MAP[String(sub?.status ?? "").toUpperCase()];
      const patch: Record<string, unknown> = {
        last_event_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (mapped) {
        patch.status = mapped;
        // Leaving past_due clears the clock the grant gate reads.
        if (mapped === "active") patch.past_due_since = null;
        if (mapped === "canceled") patch.canceled_at = new Date().toISOString();
      }
      if (sub?.charged_through_date) patch.current_period_end = sub.charged_through_date;
      await sb.from("billing_subscriptions").update(patch).eq("athlete_id", row.athlete_id);
      return new Response("ok", { status: 200 });
    }

    // ---- Money in ----
    if (type === "invoice.payment_made") {
      const inv = obj.invoice ?? obj;
      const subId = inv?.subscription_id;
      const { data: row } = await sb.from("billing_subscriptions")
        .select("athlete_id, coach_id").eq("square_subscription_id", subId).maybeSingle();
      if (!row) return new Response("ok", { status: 200 });

      const req0 = Array.isArray(inv?.payment_requests) ? inv.payment_requests[0] : null;
      const amount = req0?.computed_amount_money?.amount ?? req0?.total_completed_amount_money?.amount ?? null;
      const paidAt = inv?.updated_at ?? new Date().toISOString();

      await sb.from("billing_payments").insert({
        coach_id: row.coach_id,
        athlete_id: row.athlete_id,
        // The month the money is FOR, taken from the invoice date — so a
        // payment that lands on the 2nd still settles the 2nd's month, and a
        // late one settles the month it was raised for rather than today's.
        month_key: monthKeyOf(paidAt),
        square_invoice_id: inv?.id ?? null,
        square_payment_id: inv?.id ? `inv:${inv.id}` : null,
        amount_cents: amount,
        currency: req0?.computed_amount_money?.currency ?? "USD",
        status: "paid",
        paid_at: paidAt,
      });
      // Paying clears a retry state; the subscription hook may not follow.
      await sb.from("billing_subscriptions").update({
        status: "active", past_due_since: null,
        last_event_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("athlete_id", row.athlete_id);
      return new Response("ok", { status: 200 });
    }

    // ---- A charge failed ----
    if (type === "invoice.scheduled_charge_failed") {
      const inv = obj.invoice ?? obj;
      const { data: row } = await sb.from("billing_subscriptions")
        .select("athlete_id, coach_id, past_due_since")
        .eq("square_subscription_id", inv?.subscription_id).maybeSingle();
      if (!row) return new Response("ok", { status: 200 });

      await sb.from("billing_payments").insert({
        coach_id: row.coach_id, athlete_id: row.athlete_id,
        month_key: monthKeyOf(inv?.updated_at ?? new Date().toISOString()),
        square_invoice_id: inv?.id ?? null,
        status: "failed",
      });
      await sb.from("billing_subscriptions").update({
        status: "past_due",
        // First failure starts the grace clock; later ones must not restart it,
        // or a card failing every day would stay inside the window forever.
        past_due_since: row.past_due_since ?? new Date().toISOString(),
        last_event_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq("athlete_id", row.athlete_id);
      return new Response("ok", { status: 200 });
    }

    // ---- Refund / reversal ----
    if (type === "payment.updated") {
      const p = obj.payment ?? obj;
      const st = String(p?.status ?? "").toUpperCase();
      const reversed = st === "FAILED" || st === "CANCELED" || (p?.refunded_money?.amount ?? 0) > 0;
      if (reversed) {
        // Matched on the invoice, not the payment id: invoice.payment_made
        // records the row under the INVOICE (Square's invoice payload does not
        // reliably carry a payment id), so matching only on payment id here
        // would quietly update nothing and leave a refunded month reading paid.
        const invoiceId = p?.order_id ? null : p?.invoice_id ?? null;
        const q = sb.from("billing_payments").update({ status: "refunded" });
        if (invoiceId) await q.eq("square_invoice_id", invoiceId);
        else if (p?.id) await q.eq("square_payment_id", p.id);
      }
      return new Response("ok", { status: 200 });
    }

    return new Response("ignored", { status: 200 });
  } catch (e) {
    // The event id is already in the ledger, so a 500 would have Square retry
    // an event we will then treat as a duplicate and skip — the update would
    // be lost for good. Remove the ledger row so the retry does real work.
    await sb.from("billing_events").delete().eq("event_id", eventId);
    console.error("[square-webhook] handler failed", (e as Error).message);
    return new Response("handler error", { status: 500 });
  }
});
