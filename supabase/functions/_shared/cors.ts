/**
 * The CORS headers a browser-called Edge Function needs, and the preflight
 * answer.
 *
 * Why this is not optional: supabase-js sends an Authorization header and a
 * JSON content type, so the browser will not send the POST until an OPTIONS
 * request to the same URL comes back saying the origin is allowed. A function
 * that does not answer OPTIONS returns its ordinary "POST only" 405 with no
 * Access-Control-Allow-Origin on it, the preflight fails, and the POST is
 * never sent at all. supabase-js surfaces that as a transport error with no
 * status and no body, which reads exactly like the server being down.
 *
 * Every response needs the header, not just the preflight: a 401 the browser
 * blocks is a 401 the caller never sees, and that is what makes this bug so
 * hard to read from the app side.
 *
 * Origin is "*" because access is decided by the JWT in the Authorization
 * header, not by where the page is served from. Nothing here relies on
 * cookies, so there is no credentialed request to widen.
 *
 * This has cost two incidents: google-calendar on 2026-08-06, then five more
 * functions found dead on 2026-08-20 when the coach's "Send me a test" push
 * failed instantly. tests/edge-function-cors.spec.js reads the call sites out
 * of cloud.js and fails if a browser-invoked function is missing this.
 */
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * Answers a preflight, or returns null when the request is a real one.
 *
 * Call it as the FIRST thing in the handler. A preflight carries no body and
 * no credentials, so anything that parses or authenticates ahead of it is
 * answering a question the browser did not ask.
 */
export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: CORS }) : null;
}
