// Every Edge Function the browser calls has to answer a CORS preflight, or the
// call never leaves the browser.
//
// supabase-js sends an Authorization header and a JSON content type, so the
// browser preflights with OPTIONS before the POST. A function that does not
// answer that OPTIONS with Access-Control-Allow-Origin fails the check, the
// POST is never sent, and supabase-js reports a transport error with no body
// and no status. Every caller in cloud.js treats that as "the server said no"
// and warns quietly to the console, so the feature is not broken loudly - it
// is simply dead.
//
// This has now cost two incidents. 2026-08-06 ("The Google connect request
// never left the browser") fixed google-calendar and left the rest. On
// 2026-08-20 the coach's brand new "Send me a test" push failed instantly for
// the same reason, and the probe that proved it showed four more functions in
// the same state: send-push (every coach nudge, bulletin and message push),
// notify-coach (every athlete action that should reach the coach's phone),
// food-search and sync-setmore. None of them had ever worked from a browser.
//
// So the guard is not "notify-coach-test handles OPTIONS". It reads the call
// sites out of cloud.js and requires it of every function the browser invokes,
// including ones added later.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cloud = readFileSync(join(ROOT, "cloud.js"), "utf8");

const invoked = [...new Set(
  [...cloud.matchAll(/functions\.invoke\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1]),
)].sort();

/** index.ts, plus any _shared file it imports, so a shared CORS helper counts. */
function sourceOf(fn) {
  const entry = join(ROOT, "supabase", "functions", fn, "index.ts");
  let src = readFileSync(entry, "utf8");
  for (const m of src.matchAll(/from "\.\.\/_shared\/([a-z-]+\.ts)"/g)) {
    const shared = join(ROOT, "supabase", "functions", "_shared", m[1]);
    if (existsSync(shared)) src += "\n" + readFileSync(shared, "utf8");
  }
  return src;
}

describe("browser-invoked Edge Functions answer the CORS preflight", () => {
  it("finds the call sites in cloud.js", () => {
    expect(invoked.length).toBeGreaterThan(4);
  });

  for (const fn of invoked) {
    it(`${fn} answers OPTIONS`, () => {
      // Before anything else: a preflight carries no body and no credentials,
      // so any auth or parsing ahead of it answers the wrong question.
      expect(sourceOf(fn)).toMatch(/req\.method\s*===\s*"OPTIONS"/);
    });

    it(`${fn} allows the origin`, () => {
      expect(sourceOf(fn)).toMatch(/Access-Control-Allow-Origin/);
    });

    it(`${fn} puts the header on every response, errors included`, () => {
      // A 401 without the header is blocked by the browser exactly like the
      // preflight was, which is what makes this class of bug so hard to read:
      // the status that would explain it never reaches the caller.
      const src = readFileSync(join(ROOT, "supabase", "functions", fn, "index.ts"), "utf8");
      const responses = [...src.matchAll(/new Response\(/g)].length;
      const withCors = [...src.matchAll(/\.\.\.CORS/g)].length;
      expect(withCors, `${responses} Response() constructions, ${withCors} carry CORS`)
        .toBeGreaterThan(0);
    });
  }
});
