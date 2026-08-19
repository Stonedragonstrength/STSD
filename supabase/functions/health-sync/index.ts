// health-sync — the Apple Health mailbox slot.
//
// Called by an athlete's iOS Shortcut (or any bridge app they point at it).
// Shortcuts cannot carry a Supabase JWT, so verify_jwt is OFF and the
// athlete's health_token IS the authentication — generated in-app, one per
// athlete, unique-indexed. Same precedent as square-webhook.
//
// This function never touches the progress row. merge_progress replaces
// whole columns from the device payload, so a weigh-in written server-side
// would be wiped by the athlete's next push from a device that predates it.
// Batches land in health_inbox instead; the athlete's app drains the mailbox
// on boot, merges locally (Renpho-style dedupe), saves, and deletes the
// consumed rows. Worst case for a bug here is a lost or duplicate batch —
// dedupe on the client absorbs duplicates, and nothing can clobber logs.
//
// POST { token, weights?: [{date, time?, weightLb?|weightKg?}],
//        workouts?: [{date, type?, minutes?, miles?, srcId?}] }
//   -> { ok: true, queued: { weights, workouts } }
//
// Expected failures (unknown token, nothing to queue) return 200 with
// ok:false — Shortcuts surfaces non-2xx as a scary run failure, and a stale
// token is an expected state, not an outage.

import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// A phone's daily batch is dozens of entries; hundreds means a
// misconfigured date range. Clamp rather than reject — the first 500 of a
// runaway export are still the most recent data the athlete wanted.
const MAX_ENTRIES = 500;

const clampList = (v: unknown): unknown[] =>
  Array.isArray(v) ? v.slice(0, MAX_ENTRIES) : [];

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "body must be JSON" });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return json({ ok: false, error: "missing token" });

  const weights = clampList(body.weights);
  const workouts = clampList(body.workouts);
  if (!weights.length && !workouts.length) {
    return json({ ok: false, error: "nothing to queue" });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: athlete } = await sb
    .from("athletes").select("id").eq("health_token", token).maybeSingle();
  if (!athlete) return json({ ok: false, error: "unknown token" });

  const { error } = await sb.from("health_inbox").insert({
    athlete_id: athlete.id,
    kind: "health-batch",
    payload: { weights, workouts },
  });
  if (error) return json({ error: "could not queue" }, 500);

  return json({ ok: true, queued: { weights: weights.length, workouts: workouts.length } });
});
