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
import { deliverToCoach } from "../_shared/coach-notify.ts";

/** Cents to "$81.00". Square sends integers; a coach reads money. */
const usd = (cents: unknown) =>
  typeof cents === "number" && Number.isFinite(cents)
    ? `$${(cents / 100).toFixed(2)}`
    : "";

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

    /**
     * Put a money event on the coach's phone, and NEVER let that break the
     * money write.
     *
     * Everything below this line is inside the handler's try, and that catch
     * deletes the ledger row and returns 500 so Square retries. A notification
     * failing must not cause a payment to be processed twice, so this swallows
     * its own errors: a push nobody gets is a bad day, a double-charged month
     * is a real problem.
     */
    const tellCoach = async (
      coachId: string | null | undefined, athleteId: string, kind: string,
      make: (name: string) => { title: string; body: string; url?: string },
    ) => {
      if (!coachId) return;
      try {
        const { data: a } = await sb
          .from("athletes").select("display_name").eq("id", athleteId).maybeSingle();
        await deliverToCoach(sb, coachId, kind, make(a?.display_name || "An athlete"));
      } catch (e) {
        console.error(`[square-webhook] notify ${kind} failed`, (e as Error).message);
      }
    };

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
      await tellCoach(row.coach_id, row.athlete_id, "payment_in", (name) => ({
        title: "💵 Payment landed",
        body: `${name} paid${amount ? ` ${usd(amount)}` : ""}`,
        url: "./",
      }));
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
      // Wired even though this event has never once arrived on this account:
      // the money comes as card charges rather than Square invoices, so the
      // decline that really happens is the FAILED payment below. If a genuine
      // invoice subscription is ever set up, the coach hears about it rather
      // than this being the one path that silently does not tell him.
      await tellCoach(row.coach_id, row.athlete_id, "charge_failed", (name) => ({
        title: "⚠️ Charge failed",
        body: `${name}'s card was declined. No money moved.`,
        url: "./",
      }));
      return new Response("ok", { status: 200 });
    }

    // ---- A month's charge was paid (or reversed) ----
    // This is the main event now. A charge is a one-off payment link for one
    // month's real amount — sessions × rate, adjusted — not a subscription
    // instalment, because the amount moves every month and discounts happen.
    // square-billing wrote a 'sent' row carrying the order id when it made the
    // link; Square's payment carries the same order id, and that is the join.
    if (type === "payment.created" || type === "payment.updated") {
      const p = obj.payment ?? obj;
      const st = String(p?.status ?? "").toUpperCase();
      const orderId = p?.order_id ?? null;

      // A refund against a CARD-ON-FILE payment, matched on the payment id.
      //
      // Those charges are made straight against the stored card and carry no
      // order id, so every order-based branch below is blind to them — a refund
      // issued from Square's own dashboard left the row reading "paid" forever
      // while the money sat back in the athlete's account, and the books went
      // on counting it as income.
      //
      // Checked FIRST, before the settle branch: a payment that has been
      // refunded must never be re-read as a fresh completion. Square keeps
      // sending payment.updated with status COMPLETED after a refund — the
      // refund shows up as refunded_money, not as a changed status.
      if ((p?.refunded_money?.amount ?? 0) > 0 && p?.id) {
        const { data: hit } = await sb.from("billing_payments")
          .select("id").eq("square_payment_id", p.id).maybeSingle();
        if (hit) {
          await sb.from("billing_payments")
            .update({ status: "refunded" }).eq("id", hit.id);
          return new Response("ok", { status: 200 });
        }
      }

      if (st === "COMPLETED" && orderId) {
        const { data: charge } = await sb.from("billing_payments")
          .select("id, status, coach_id, athlete_id").eq("square_order_id", orderId).maybeSingle();
        if (charge) {
          // Only ever forward, and only from 'sent'. Square sends both created
          // and updated for one payment, plus retries; without this guard a
          // refunded charge could be walked back to paid by a late duplicate.
          if (charge.status === "sent") {
            await sb.from("billing_payments").update({
              status: "paid",
              square_payment_id: p?.id ?? null,
              paid_at: p?.updated_at ?? new Date().toISOString(),
              // What Square actually took, which is the number that matters if
              // the athlete somehow paid a different amount.
              amount_cents: p?.amount_money?.amount ?? undefined,
            }).eq("id", charge.id);
            // The one that actually happens: this is how a month gets paid.
            await tellCoach(charge.coach_id, charge.athlete_id, "payment_in", (name) => {
              const paid = usd(p?.amount_money?.amount);
              return {
                title: "💵 Payment landed",
                body: `${name} paid${paid ? ` ${paid}` : ""}`,
                url: "./",
              };
            });
          }
          return new Response("ok", { status: 200 });
        }
        // An order we didn't raise — a card taken in person, say. Not ours to
        // interpret, and inventing a month for it would settle the wrong one.
        return new Response("ok", { status: 200 });
      }

      // A DECLINE, which is not the same thing as the reversal below: a refund
      // is money going back on purpose and a cancel is a charge that never
      // started, while this is a card that said no to money the coach was
      // owed. It is the branch a real failure reaches on this account, since
      // no invoice event has ever arrived here. Matched back to the row we
      // raised so the coach hears WHOSE card it was.
      if (st === "FAILED" && (orderId || p?.id)) {
        const { data: hit } = await sb.from("billing_payments")
          .select("coach_id, athlete_id")
          .eq(orderId ? "square_order_id" : "square_payment_id", orderId ?? p.id)
          .maybeSingle();
        if (hit) {
          await tellCoach(hit.coach_id, hit.athlete_id, "charge_failed", (name) => ({
            title: "⚠️ Charge failed",
            body: `${name}'s card was declined. No money moved.`,
            url: "./",
          }));
        } else {
          console.warn("[square-webhook] FAILED payment matched no row", p?.id, orderId);
        }
      }

      const reversed = st === "FAILED" || st === "CANCELED" || (p?.refunded_money?.amount ?? 0) > 0;
      if (reversed && orderId) {
        // Reversed money un-settles the month it paid for, which is the one
        // case where "paid" legitimately goes backwards. settleBilledPackages
        // only ever CLEARS an owed flag, so the coach is told rather than the
        // athlete being silently re-billed.
        await sb.from("billing_payments")
          .update({ status: "refunded" })
          .eq("square_order_id", orderId);
        return new Response("ok", { status: 200 });
      }
      if (reversed) {
        // No order id — an invoice payment (the subscription path below, kept
        // for anyone genuinely on a flat monthly). Matched on the invoice
        // rather than the payment id, because Square's invoice payload does
        // not reliably carry one, and matching on it would quietly update
        // nothing and leave a refunded month still reading paid.
        const q = sb.from("billing_payments").update({ status: "refunded" });
        if (p?.invoice_id) await q.eq("square_invoice_id", p.invoice_id);
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
