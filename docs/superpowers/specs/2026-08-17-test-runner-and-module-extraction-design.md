# A test runner, and getting the logic out of the IIFE

**Status:** phase 0 shipped (`c5a9e60`). Phase 1 (Sync) underway — owner
approved 2026-08-17 evening. Mechanism while no bundler ships: each `src/`
module is a classic script assigning onto `globalThis.STSD`, loaded by its own
`?v=` script tag before `app.js`; tier-1 specs import the same file and read
the namespace, so the shipped code is the tested code.
**Owner decisions on file:** incremental extraction, pure logic first; domain order
Sync → Training → Money → Scheduling; Vite deferred (see §2).

---

## 1. The problem

`app.js` is 41,988 lines, one strict-mode IIFE, zero exports. `state` is a
module-level object at `app.js:3408` closed over by ~1,400 functions and run
through ~110 lines of in-place boot migrations at `3423-3559` before anything
outside could see it.

Measured composition:

| | functions | lines |
|---|---|---|
| DOM/browser-bound | 614 | 25,301 |
| pure logic | 815 | 9,688 |
| **total** | **1,429** | **41,989** |

Nothing in it can be imported, so the 40 existing tests reach it by reading the
source text and brace-matching a named function out of it. That works — 38 of
the 40 test genuinely shipped code — but it means **a rename breaks the
extraction, not the assertion**: the test throws "not found" instead of failing
a claim, and stops testing while still looking like a test.

That is the same shape as this codebase's house failure: a thing that quietly
does nothing.

## 2. Decisions

**Vitest now, Vite later.** Vite's real wins here are minification (`app.js`
ships 2.2 MB unminified) and content-hashed filenames, which would delete the
stale-cache bug class that has twice served wedged bundles to real users. Both
are worth having. Neither is worth taking during the extraction work, because:

- bundling one 42k-line IIFE produces exactly one chunk, which is the *worst*
  cache-granularity outcome — a one-line CSS fix would re-download the whole app
  on every installed phone;
- it changes the publish path of a live app that takes payments, in the same
  stretch where the most code is moving;
- there is no module graph yet for it to chunk sensibly. Extraction creates one.

So Vite lands as its own change, after `src/` exists, when it can split on real
boundaries. §7 keeps the door open and lists what must be true first.

**No `"type": "module"` in `package.json`.** It would break `require` in 26 test
files and `__dirname` in 26 more, and affects nothing in the browser. Flipping it
is a quiet standalone commit later, not a passenger on a bundler change.

**Legacy tests are wrapped, not rewritten.** `tests/legacy.spec.js` runs each as
its own Vitest case. 9,188 lines stay untouched; each is ported for real when its
domain moves, assertions carried across verbatim.

## 3. Test architecture

Four tiers, because "unit test everything" means three different things here and
collapsing them hides what is not covered.

| Tier | What | Where | Reaches |
|---|---|---|---|
| 1 | Real `import` of extracted modules | `src/**/*.spec.js` | the 9,688 lines of logic, as they move |
| 2 | Source extraction via `tests/helpers/load-fn.js` | `tests/**/*.spec.js` | logic still inside the IIFE |
| 3 | Boot the real `index.html` + `app.js` in jsdom | `tests/dom/*.spec.js` | the 614 render/handler functions |
| 4 | Real Chromium, touch emulation | `tests/browser/*.mjs` | layout, hit-testing, `pointer: coarse` |

Tier 2 is a bridge and also the safety net: **a domain gets tier-2 coverage
before any of it moves, and the same tests must pass after.** That is what makes
the extraction survivable in a codebase that fails silently.

Tier 4 exists because tier 3 structurally cannot see it. A desktop viewport
reports `pointer: fine`, so all eight `@media (pointer: coarse)` blocks are inert
in jsdom and in any desktop harness — which is exactly how the day-card tap bug
(`8847c5d`) survived 39 passing tests.

Coverage is reported on `src/` where it is real, and separately for tiers 2-3,
rather than one flattering number.

## 4. The extraction contract

Every extraction commit obeys all of these. They are not style preferences; each
one is a failure this codebase has already had.

1. **Tests first, same commit for the port.** The domain's tier-2 tests pass
   before the move and after it. The extraction and the test port land together —
   split across two commits, the brace-matchers break and the domain silently
   un-tests itself.
2. **No `src/` module captures `window.Cloud` or a table global at import time.**
   Every sync path reads `window.Cloud?.enabled` at *call* time. That is what lets
   the app boot with no config and run local-only, and every offline harness
   depends on it. Read through a getter or pass per call.
3. **No shared mutable singleton becomes a module-level `let`.** The dirty flags,
   the push queue and the five session windows exist so that a writer and a reader
   in different call stacks see the same cell. A duplicated instance makes the
   guard a no-op *with no error* — construct once in `app.js` and thread it.
4. **Assert the positive, and mutation-check the guards.** "Imports resolve" and
   "no console errors" prove almost nothing here. One positive assertion per moved
   function; every guard predicate gets a mutation check.
5. **Identity returns are load-bearing.** `mergedRosterProgress` (`app.js:4364`)
   identity-returns its input so `pullProgressFromCloud:6729` can test
   `next !== c.importedProgress` to decide whether to repaint. Do not "clean up"
   into a fresh object. Same for `normalizeAvailability`'s derived `bo_${d}` id
   (`22925`), which is what makes legacy-blackout adoption idempotent.
6. **Locale formatters move as parts, never as strings.** `fmtSlotTime`,
   `money`, `monthKeyLabel` and friends are ICU- and device-dependent by design;
   `bookingsByDate`'s dedupe exists because those strings are unstable across
   Chrome versions. Never key on formatted output.
7. **Transaction boundaries stay put.** `saveTrainer` (478), `saveClient` (562),
   `bankMutated` (1208), `ensureSessionBank` (923) and the apply halves do not
   move. ~600 call sites depend on their exact side-effect set.

## 5. Phases

Each phase ends at a gate: suite green, mutation-checked, committed, pushed.

**Phase 0 — runner. SHIPPED (`c5a9e60`).** Vitest, the legacy bridge, and
`load-fn.js` with the error messages the 38 copies never had. 50 tests green.

**Phase 1 — Sync.** Rated MEDIUM overall: the cleanest pure core of the four,
the dirtiest session state. The anatomy is uniform — *read cloud → decide → write
state + localStorage + repaint*. Extract the decide half; leave apply.

Six zero-risk modules first (`merge-logs`, `merge-by-id`, `progress-shape`,
`roster-progress`, `program`, `rows`), then `rules.js` — the payoff module, which
turns four inline `if` chains into named predicates and makes the boot path and
`resyncNow` call the *same* rule instead of two copies that already differ.

`dirty.js` and `push-queue.js` are deferred to the very end of the whole
programme, not the end of Sync: they are the two places a duplicated singleton
would fail invisibly.

**Phase 2 — Training engine.** Lift identity and tags, the double-progression
engine, the day generator, the muscle map and coverage bands, the stat pentagon.

**Phase 3 — Money.** ~2,900 lines over eight non-contiguous regions, three
near-pure cores (ledger, pricing, projection). Real money: no data is touched,
and any fix that changes a number owned by an athlete is the owner's to apply.

**Phase 4 — Scheduling.** ~15 genuinely pure functions (zone maths, slot
generation, notice window, series expansion, the two dedupes) inside ~40 impure
orchestrators.

**Phase 5 — Vite.** Only once `src/` gives it something to chunk. Preconditions
in §7.

## 6. Intent gaps

The brief is to test against *intent*, not against what the code happens to do.
Where they disagree it is a finding, not a test. Findings split two ways:

- **Settleable from the code's own stated intent** — a comment, a design doc or
  an adjacent function says what was meant. I fix, and say what changed.
- **Only the owner knows** — two defensible readings, or a number that belongs to
  a real athlete. These get asked, batched, with the actual figures.

The reconnaissance pass found roughly 30 of the first kind and 22 of the second.
The second list is the gate on Phases 1-4: **extraction enshrines behaviour, so a
contested behaviour is ruled on before the module that would freeze it is
written.** Specifically, `src/scheduling/merge.js` waits on the Setmore-cutoff and
`slotKey` questions, and the `bankMutated` field list waits on its own.

The canonical example, already confirmed: `athleteCurrentDay`'s `anyWork`
(`app.js:5069`) counts an entry with `sets.length` as work even when
`locked === false`, while the day card's `hasAnyLog` counts only locked entries.
One says a day is done; the other says 5/6 logged. Both are defensible. A test
cannot pick.

## 7. Preconditions for Vite (Phase 5)

- `src/` exists with real boundaries, so `manualChunks` can split on something
  other than "everything".
- `sw.js` rewritten for content-hashed names: cache-first on `/assets/`, the
  `?v=` convention retired, `CACHE` bumped once to evict wedged copies.
- `public/` holds everything shipped verbatim — **`CNAME` above all**, plus
  `manifest.json`, icons, `avatars/`, `fonts/`, `vendor/`, `config.js`.
- `config.js` stays a runtime file, not an inlined env var: the anon key is public
  by design, and stubbing it is how every offline harness boots.
- `supabase/` (57 migrations, 15 Deno functions) and `docs/` are excluded from the
  build. Sweeping `square-billing` into a browser bundle would ship the coach's
  Square logic and still not deploy it.
- Pages source switched from "deploy from a branch" to "GitHub Actions" — an owner
  action in repo settings.
- The cutover commit does **not** delete the working root files, so rollback is
  flipping that setting back, with no code change.
- Do not code-split on the first cutover; `precacheShellAssets` only precaches
  what `index.html` references, so a dynamic chunk would break an offline route
  that worked yesterday.
- Pin `@supabase/supabase-js` in a commit of its own, after the bundler. Today the
  CDN `@2` floats and `cacheFirst` never revalidates, so installed PWAs are frozen
  on whatever 2.x existed at install — different per device.

## 8. Known trap

25 tests match declaration text character-for-character —
`tests/band-tags.test.js:296` matches `function progressionRule(ex) {` exactly.
Renaming a parameter, reformatting, or writing `export function` breaks the
match. `load-fn.js` now throws a named error rather than returning nothing, but
the rule stands: **touch a matched declaration and update its test in the same
commit.**
