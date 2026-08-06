/**
 * Who is calling a browser-facing function?
 *
 * The obvious way is to build a second supabase-js client out of
 * SUPABASE_ANON_KEY, hand it the caller's Authorization header, and ask it
 * `auth.getUser()`. Every function here did that. It broke on 2026-08-06.
 *
 * Supabase manages SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY, and when
 * the project moved to the new API key format it rewrote both underneath the
 * functions — `sb_publishable_…` and `sb_secret_…`, neither of which is a JWT.
 * A client constructed from a key that is no longer a project JWT cannot verify
 * anybody's token, so every caller holding a perfectly valid, unexpired session
 * was answered "not signed in". Nothing surfaced it: the functions returned a
 * clean 401, the app showed its ordinary "couldn't do that" message, and the
 * rest of the app kept working because PostgREST validates tokens by a
 * different path.
 *
 * This is the same shape of failure _shared/cron-auth.ts documents for the
 * service-role key, and the fix rhymes: stop depending on the FORMAT of a
 * managed key. Ask GoTrue over plain HTTP instead. It validates the token and
 * returns the user whatever the project's keys look like, and the only thing
 * that can break it is the auth service actually being down.
 *
 * Returns the user id, or null. A null means "not signed in" and callers should
 * 401 — it never means "assume it's fine".
 */
export async function callerUserId(req: Request, supabaseUrl: string): Promise<string | null> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  // The apikey header is required by the gateway but is not what authenticates
  // the call — the bearer token is. Either managed key satisfies it, so this
  // takes whichever exists rather than insisting on a particular one.
  const apikey = Deno.env.get("SUPABASE_ANON_KEY")
    ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? "";
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey, Authorization: `Bearer ${jwt}` },
    });
    if (!res.ok) return null;
    const user = await res.json().catch(() => null);
    return user?.id ?? null;
  } catch (e) {
    console.warn("[caller-auth] getUser failed", (e as Error).message);
    return null;
  }
}
