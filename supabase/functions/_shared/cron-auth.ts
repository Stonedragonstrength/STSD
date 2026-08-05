/**
 * Is this request the scheduler, or somebody else?
 *
 * Every cron-driven function used to answer that with
 *
 *     if (!auth.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)) -> 403
 *
 * which compares the caller's bearer token to an environment variable Supabase
 * owns and can change without warning. On 2026-08-05 it had: the Vault held the
 * project's legacy service_role JWT — correct role, correct project ref, valid
 * until 2036 — while the functions saw a different value in that variable. The
 * requests passed Supabase's own JWT gate and were then rejected by this line,
 * 403, every fifteen minutes. session-reminder and workout-reminder had both
 * been silently dead since the day they were deployed. Nothing surfaced it:
 * pg_cron reported "succeeded" because posting the request succeeded, and the
 * only trace was the response body sitting in net._http_response.
 *
 * Swapping in the new key would not have fixed it either, only moved the
 * failure earlier — the new `sb_secret_...` format is not a JWT, so with
 * verify_jwt on it is rejected by the gateway before a function ever runs.
 *
 * So identity is taken from the token's CLAIMS rather than from its bytes: a
 * caller is the scheduler if it presents a JWT issued for this project whose
 * role is service_role. That is true of every service-role key this project has
 * had and will have, so key rotation stops breaking the schedule silently. The
 * exact-match check is kept as a first test for the day the two agree again.
 *
 * The anon key cannot pass: it is a valid project JWT, but its role is "anon".
 * That distinction is the whole security of this — a plain "did verify_jwt let
 * it through" test would accept the anon key, which is public and shipped in
 * the client.
 *
 * No signature check here. Supabase verifies the signature at the gateway when
 * verify_jwt is on (it is, for all three of these), so by the time this runs the
 * token is known-authentic and only its claims are in question. Never call this
 * from a function with verify_jwt disabled.
 */
export function isServiceRoleCaller(authHeader: string | null): boolean {
  const raw = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!raw) return false;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && raw === serviceKey) return true;

  const claims = decodeJwtClaims(raw);
  if (!claims) return false;
  if (claims.role !== "service_role") return false;

  // Pin it to this project, so a service_role token minted for some other
  // Supabase project cannot drive this one's schedule.
  const ref = projectRef();
  if (ref && claims.ref && claims.ref !== ref) return false;

  return true;
}

type Claims = { role?: string; ref?: string; exp?: number };

/** Payload only. Signature is the gateway's job — see the note above. */
function decodeJwtClaims(token: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null; // not a JWT (e.g. an sb_secret_ key)
  try {
    // base64url -> base64, then pad to a multiple of four.
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)),
    );
    const claims = JSON.parse(json) as Claims;
    // An expired token is not a caller, whatever its role says.
    if (typeof claims.exp === "number" && claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/** `thhfslggjmtciavxrwwz` out of `https://thhfslggjmtciavxrwwz.supabase.co`. */
function projectRef(): string | null {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const m = url.match(/^https?:\/\/([a-z0-9]+)\.supabase\./i);
  return m ? m[1] : null;
}
