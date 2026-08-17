import { defineConfig } from "vitest/config";

// NOTE: package.json deliberately has NO `"type": "module"`.
//
// The 40 tests in tests/*.test.js are plain CommonJS Node scripts that predate
// this runner, and they are not throwaway — 38 of them read the real app.js and
// pull functions out of it by brace-matching, so they test shipped code rather
// than a copy. Setting "type": "module" would break `require` in every one of
// them at once, and the suite would go dark for as long as the port took.
// Without it they keep running exactly as before, tests/legacy.spec.js keeps
// them in the reported suite, and each one gets ported properly when its domain
// is extracted to src/. Vitest transpiles its own spec files either way, so ESM
// syntax in *.spec.js works regardless.
export default defineConfig({
  test: {
    // Most logic here is pure; node is much faster than jsdom. Specs that need
    // a DOM opt in per file with `// @vitest-environment jsdom` at the top.
    environment: "node",
    include: ["tests/**/*.spec.js", "src/**/*.spec.js"],
    // The legacy runner shells out to 40 node processes; give it room.
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      // Only what we actually ship and could reasonably cover. app.js is here
      // deliberately even though the number will read low for a while: tiers 2
      // and 3 exercise it without importing it, so v8 does not credit them.
      // A low honest number beats a high flattering one.
      include: ["src/**/*.js", "app.js", "cloud.js"],
      exclude: [
        "**/node_modules/**",
        "**/*.spec.js",
        "**/*.test.js",
        "vendor/**",
        "android-widget/**",
        "supabase/**",
        "scripts/**",
        // Generated data tables, not logic.
        "exercise-demos.js",
        "food-db.js",
      ],
      reporter: ["text", "html"],
    },
  },
});
