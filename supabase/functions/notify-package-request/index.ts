// Emails the coach when an athlete requests a session package.
// Requires the RESEND_API_KEY secret (resend.com); no-ops with a warning
// in the response when it isn't configured, so the app flow never breaks.
import { createClient } from "jsr:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  try {
    const { athleteId, size, price } = await req.json().catch(() => ({}));
    if (!athleteId || !size) return json({ ok: false, error: "athleteId and size required" }, 400);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: athlete } = await sb.from("athletes")
      .select("id, display_name, coach_id")
      .eq("id", athleteId)
      .maybeSingle();
    if (!athlete) return json({ ok: false, error: "athlete not found" }, 404);

    const { data: coach } = await sb.from("coaches")
      .select("email, display_name")
      .eq("id", athlete.coach_id)
      .maybeSingle();
    if (!coach?.email) return json({ ok: false, error: "coach has no email" }, 404);

    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return json({ ok: false, error: "RESEND_API_KEY not configured" });

    const name = athlete.display_name || "An athlete";
    const priceTxt = price ? ` — $${Number(price).toLocaleString("en-US")}` : "";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Stone Dragon <onboarding@resend.dev>",
        to: [coach.email],
        subject: `💪 ${name} wants to buy ${size} sessions${priceTxt}`,
        text: [
          `${name} just requested a ${size}-session package${priceTxt} in the Stone Dragon app.`,
          ``,
          `Once they've paid (Venmo, cash, etc.), open their Sessions tab and tap "Approve & mark paid" to add the sessions.`,
        ].join("\n"),
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("Resend error", res.status, detail);
      return json({ ok: false, error: `email send failed (${res.status})` });
    }
    return json({ ok: true });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String(e) }, 500);
  }
});
