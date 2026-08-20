// Every category the settings screen offers has to have something that fires
// it.
//
// The seventeen categories shipped on 2026-08-19 with switches, labels, hints,
// defaults, modes, quiet hours and a digest. Ten of them had a producer. The
// other seven were switches over nothing: `bug_report` and `invite_claimed`
// had recipes written and no caller, and the five `source: "server"` ones were
// specced to be raised by the Square webhook and the digest cron, neither of
// which had a single call to deliverToCoach in it.
//
// Nothing reports that. A coach turns a category on, the mode saves, the row
// updates, and no notification ever arrives, which is indistinguishable from
// "nothing has happened yet".
//
// So: for every kind in the canonical list, find its producer.
//   client -> app.js calls tellCoach("kind", id)
//   server -> some Edge Function calls deliverToCoach(..., "kind", ...)
// booking_request is produced through the older notifyCoachOfRequest wrapper
// and is spelled out below rather than special-cased in the scan.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "../src/notify/coach-kinds.js";

const { COACH_KINDS } = globalThis.STSD.notify;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(ROOT, "app.js"), "utf8");

// Kinds with no producer YET. Empty is the goal; anything listed here is a
// switch the coach can turn on that will never fire, and it is listed so that
// the gap is a decision somebody wrote down rather than a silence.
const NOT_WIRED = new Set([
  // Needs a trigger decision: the session bank is computed in the coach's
  // browser (src/money/ledger.js), and nothing on the server can say a
  // balance reached zero without duplicating that arithmetic.
  "balance_zero",
]);

/** Kinds app.js fires through tellCoach(), plus the legacy booking wrapper. */
function clientProduced() {
  const out = new Set(
    [...app.matchAll(/tellCoach\(\s*"([a-z_]+)"/g)].map((m) => m[1]),
  );
  if (/notifyCoachOfRequest\?\.\(/.test(app)) out.add("booking_request");
  return out;
}

/** Kinds any Edge Function hands to deliverToCoach(). */
function serverProduced() {
  const out = new Set();
  const dir = join(ROOT, "supabase", "functions");
  for (const fn of readdirSync(dir)) {
    if (fn === "_shared") continue;
    let src;
    try { src = readFileSync(join(dir, fn, "index.ts"), "utf8"); } catch { continue; }
    // The kind is an argument of the call, so look at the call site rather
    // than the whole file: coach-digest names all seventeen in its label
    // table, and matching those would call every category wired.
    //
    // A local tellCoach() wrapper counts as the call site, because that is
    // what the kind literal is written against. square-webhook has one so a
    // notification failing can never roll back a payment, and the file must
    // still contain deliverToCoach for the wrapper to mean anything.
    const calls = /deliverToCoach\(/.test(src)
      ? src.matchAll(/(?:deliverToCoach|tellCoach)\(/g)
      : [];
    for (const m of calls) {
      const window = src.slice(m.index, m.index + 200);
      for (const k of window.matchAll(/"([a-z_]+)"/g)) out.add(k[1]);
    }
  }
  return out;
}

describe("every coach notification kind has a producer", () => {
  const client = clientProduced();
  const server = serverProduced();

  it("reads both sides", () => {
    expect(client.size, "no tellCoach() call sites found in app.js").toBeGreaterThan(5);
    expect(server.size, "no deliverToCoach() call sites found in any function").toBeGreaterThan(0);
  });

  for (const k of COACH_KINDS) {
    const wired = client.has(k.id) || server.has(k.id);
    if (NOT_WIRED.has(k.id)) {
      it(`${k.id} is knowingly unwired`, () => {
        // Flips to a failure the moment it IS wired, so the list above cannot
        // outlive the gap it documents.
        expect(wired, `${k.id} now has a producer: take it out of NOT_WIRED`).toBe(false);
      });
      continue;
    }
    it(`${k.id} is fired by something`, () => {
      expect(wired, k.source === "server"
        ? `no Edge Function hands "${k.id}" to deliverToCoach()`
        : `app.js never calls tellCoach("${k.id}", ...)`).toBe(true);
    });
  }
});
