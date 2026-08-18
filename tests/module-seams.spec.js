// The extraction's seam guard: app.js and the src/ modules must agree about
// every name that crossed the boundary.
//
// The class of failure this kills: a cut moves a declaration into a module
// but app.js still references the name (or the module forgets to export it,
// or the pull block forgets to list it). The boot smoke CANNOT see this —
// nothing throws at load, a const simply isn't there when the feature's
// button is pressed. That exact bug shipped with the builder brick: the 🎲
// generator's _shuffle/_exercisesForCats/_genTags/GEN_ISO_KW moved without
// being exported, and "Surprise me" was a live ReferenceError until this
// guard's ancestor scan caught it.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(ROOT, "app.js"), "utf8");
// References are checked against comment-stripped app.js so a pointer
// comment ("foo moved to src/...") cannot false-positive.
const appCode = app.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const moduleFiles = [];
for (const d of ["src/sync", "src/training"]) {
  for (const f of readdirSync(join(ROOT, d))) {
    if (f.endsWith(".js") && !f.endsWith(".spec.js")) moduleFiles.push(join(d, f));
  }
}

/** Names app.js pulls off the namespaces. */
function pulledNames() {
  const pulls = new Set();
  for (const m of app.matchAll(/const \{([\s\S]*?)\} = globalThis\.STSD\.(?:sync|training);/g)) {
    m[1].split(",").forEach((n) => { const t = n.trim(); if (t) pulls.add(t); });
  }
  return pulls;
}

/** Top-level declarations of one module file. */
function declaredIn(file) {
  const src = readFileSync(join(ROOT, file), "utf8");
  const names = [];
  for (const m of src.matchAll(/^  (?:function|const|let) ([A-Za-z_$][A-Za-z0-9_$]*)/gm)) {
    names.push(m[1]);
  }
  return names;
}

describe("the module seams", () => {
  const pulls = pulledNames();

  it("every module-internal name app.js references is pulled off the namespace", () => {
    const free = [];
    for (const f of moduleFiles) {
      for (const name of declaredIn(f)) {
        if (pulls.has(name)) continue;
        // Still declared in app.js itself (a name that never moved) is fine.
        if (new RegExp(`(function|const|let) ${name}\\b`).test(appCode)) continue;
        // A bare-identifier reference only: `.name` is a property access
        // (window.Cloud.rowToAthlete is Cloud's export, not this seam).
        if (new RegExp(`(?<![.\\w$])${name.replace(/\$/g, "\\$")}\\b`).test(appCode)) {
          free.push(`${name} (lives in ${f})`);
        }
      }
    }
    expect(free, "app.js references these but nothing defines them there — export and pull them").toEqual([]);
  });

  it("every name the pull blocks list actually exists on the namespace", async () => {
    // Execute the real modules in index.html order and compare.
    globalThis.window = globalThis;
    await import(join(ROOT, "exercise-demos.js").replace(/\\/g, "/"));
    await import(join(ROOT, "exercise-muscles.js").replace(/\\/g, "/"));
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    const tags = [...html.matchAll(/<script src="(src\/[^"?]+)/g)].map((m) => m[1]);
    for (const t of tags) await import(join(ROOT, t).replace(/\\/g, "/"));
    const ns = { ...globalThis.STSD.sync, ...globalThis.STSD.training };
    const missing = [...pulls].filter((n) => !(n in ns));
    expect(missing, "pulled in app.js but not exported by any module").toEqual([]);
  });
});
