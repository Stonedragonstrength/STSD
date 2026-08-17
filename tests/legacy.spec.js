// Bridge: keep the 40 pre-Vitest tests in the reported suite, unported.
//
// They are plain CommonJS Node scripts that exit non-zero on failure, and they
// are good — 38 of the 40 read the real app.js and brace-match functions out of
// it, so they test shipped code rather than a copy of it. Rewriting 9,188 lines
// of them into describe/it up front would be a lot of mechanical churn for zero
// new coverage, and would leave the suite dark while it happened.
//
// So each one runs as its own Vitest case here, and gets ported for real when
// its domain is extracted to src/ — at which point the assertions move across
// unchanged and its entry disappears from this file. When tests/ has no
// *.test.js left, delete this.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const legacy = readdirSync(HERE)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

describe("legacy node tests", () => {
  it("finds the legacy suite", () => {
    // A glob that quietly matches nothing would report a green suite that ran
    // no tests at all, which is the exact failure this codebase specialises in.
    expect(legacy.length).toBeGreaterThan(0);
  });

  it.each(legacy)("%s", (file) => {
    try {
      execFileSync(process.execPath, [join(HERE, file)], {
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (err) {
      // The scripts report what failed on stdout; surface it rather than just
      // the exit code, or a red test says nothing about why.
      const out = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
      throw new Error(`${file} exited ${err.status}\n\n${out}`);
    }
  });
});
