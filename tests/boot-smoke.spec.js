// The whole suite was green while the shipped app was dead.
//
// 2026-08-17: an extraction moved functions out of app.js and pulled them
// back off the namespace with a `const` placed at the old declaration site —
// BELOW the boot migrations that call them. Function declarations hoist;
// consts do not. Boot hit the TDZ, the IIFE died, the login screen painted
// with nothing clickable — and 125 tests passed, because nothing in the
// suite ever EXECUTES app.js top to bottom. This does.
//
// It is a smoke test, not a harness: DOM and network are inert stubs, and
// the one claim is that every script index.html ships, executed in the order
// index.html ships them, runs to completion. A missing namespace member, a
// TDZ, a duplicate declaration, a top-level typo — anything that would kill
// the IIFE at boot — fails here first.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// The scripts under test: every src/ module index.html references, in
// index.html's own order, then app.js. The data/library scripts and cloud.js
// are deliberately not executed — they predate this test, carry their own
// CDN/config expectations, and app.js reads them at call time, not at boot.
function shippedScripts() {
  const html = read("index.html");
  const srcs = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1].split("?")[0]);
  const modules = srcs.filter((s) => s.startsWith("src/"));
  expect(srcs).toContain("app.js");
  return [...modules, "app.js"];
}

const noop = () => {};
const mkEl = () => ({
  addEventListener: noop, removeEventListener: noop,
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  style: { setProperty: noop }, dataset: {}, setAttribute: noop, getAttribute: () => null,
  querySelector: () => null, querySelectorAll: () => [], appendChild: noop,
  textContent: "", innerHTML: "", value: "",
});
const storage = () => {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
  };
};
function sandbox() {
  const s = {
    console, Intl, URL, URLSearchParams,
    document: {
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener: noop, removeEventListener: noop, createElement: mkEl,
      body: mkEl(), documentElement: mkEl(), head: mkEl(),
    },
    navigator: { onLine: true, userAgent: "boot-smoke", serviceWorker: { register: () => Promise.resolve() } },
    localStorage: storage(), sessionStorage: storage(),
    location: { href: "https://smoke/", search: "", hash: "", origin: "https://smoke", pathname: "/" },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: () => Promise.resolve({ ok: false, json: async () => ({}) }),
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    addEventListener: noop, removeEventListener: noop,
    requestAnimationFrame: noop, cancelAnimationFrame: noop,
    history: { replaceState: noop }, crypto: { randomUUID: () => "x" },
    structuredClone: (x) => JSON.parse(JSON.stringify(x)),
    alert: noop, confirm: () => false, Audio: function () { return { play: noop }; },
    Notification: undefined, screen: { width: 1200, height: 800 },
  };
  s.window = s;
  s.globalThis = s;
  s.self = s;
  vm.createContext(s);
  return s;
}

describe("boot smoke", () => {
  it("every shipped script executes to completion, in index.html's order", () => {
    const ctx = sandbox();
    for (const file of shippedScripts()) {
      // One vm.runInContext per file so a throw names its file, the same way
      // the browser's script boundary would.
      vm.runInContext(read(file), ctx, { filename: file });
    }
    // The positive assertion: boot finished AND the extractions actually
    // registered. An empty namespace with a green run would mean the smoke
    // quietly stopped testing — the house failure, again.
    expect(Object.keys(ctx.STSD?.sync ?? {}).length).toBeGreaterThan(0);
  });
});
