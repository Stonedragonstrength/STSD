---
name: verify
description: How to run and drive the STSD app locally to verify coach-side UI changes without real credentials.
---

# Verifying STSD changes locally

No build step — the app is static files. The user often already runs a server
on port 5190 (`python3 -m http.server 5190`), but that origin uses the real
Supabase config, and boot only shows the coach UI with a live Supabase session
(the offline restore at the bottom of `init()` in app.js only runs when
`window.Cloud.enabled` is false).

## Sandbox recipe (no credentials needed)

1. Serve the repo on another port with `config.js` stubbed to
   `window.STONE_DRAGON_CONFIG = {}` — Cloud then boots disabled and the
   offline restore path works. `python` is NOT installed on this machine;
   Node is. Write a small Node static server that special-cases `/config.js`
   and serves everything else from the repo root (see pattern used before:
   scratchpad `sandbox-server.js`, port 5191).
2. In the browser tab on the sandbox origin, seed a minimal coach account
   (boot migrations backfill the rest) and flag the session:

   ```js
   localStorage.setItem("trainerpro_data_v1", JSON.stringify({
     trainer: { name: "Test Coach", email: "test@example.com" },
     clients: [{ id: "testc1", name: "Test Athlete",
       weeks: [{ id: "w1", label: "Week 1", focus: "", phaseLabel: "", days: [
         { id: "d1", name: "Day 1", exercises: [] }] }] }]
   }));
   sessionStorage.setItem("trainerpro_session_v1", "trainer");
   location.reload();
   ```

3. You land on the coach dashboard. The exercise-library sidebar lives in the
   day editor: Programs → "+ New day".

## Cache layers (each one cost a debugging cycle on 2026-08-11)

The sandbox has FOUR caches between an edit and the running page, and they
fail one at a time, in this order of likelihood:

1. **The service worker re-registers on every boot.** Unregistering it once
   is not enough — the next app load registers it again and re-caches the
   current `?v=` URLs. Either unregister + clear `caches` in the same script
   that reloads, or rely on rule 2.
2. **The only reliable cache-buster is a NEW `?v=` URL.** Chrome's disk
   cache keeps the headers an entry was BORN with: a script cached before
   the server sent `Cache-Control: no-store` stays heuristically fresh and
   ignores the new header forever. `fetch(url, {cache:'reload'})` priming is
   unreliable. When an edit doesn't seem to arrive, bump the tag in
   index.html — and bump it for EVERY file you changed (`cloud.js` has its
   own tag and is easy to forget; forgetting it in production is how a
   cloud.js fix silently didn't ship this morning).
3. **A mock served in place of `/cloud.js` boots Cloud ENABLED**, so the
   post-overhaul boot pulls from the mock and OVERWRITES whatever you seeded
   in localStorage (program, progress, readiness — everything but merged
   logs). Seed fixtures INSIDE the mock's responses, not in localStorage.
   And when the feature under test unions two sources (e.g. `_coachBookings`
   ∪ `upcomingBookings`), run one pass per source with the other empty — a
   mirror-only seed "verified" the Money strip while its real source path
   was broken.
4. **`computer` screenshots go stale on these tabs** — captureScreenshot
   times out, then serves an old frame that no longer matches the DOM.
   Assert state by DOM queries (classes, rects, values), treat screenshots
   as illustration only, and prefer a fresh tab per test round.

## Iframe width testing (tablet/mobile passes)

An iframe on the sandbox origin gets its own viewport, so media queries can
be tested at 390/768/1024 without resizing Chrome. Rules learned 2026-08-12:

- **Run exactly ONE app instance.** The outer tab and the iframe share
  localStorage AND sessionStorage; if the outer tab is also running the app,
  its timers re-save its own in-memory state and silently overwrite whatever
  you seed for the iframe. Park the outer tab on `/manifest.json` (same
  origin, no app boot) before seeding, then create the iframe.
- **Reseeding mid-session: REMOVE the iframe first, then seed, then create a
  fresh iframe.** `clear() → setItem() → iframe.reload()` loses the race: the
  still-running instance's debounced saves fire between the setItem and the
  reload and quietly restore the old state (cost a cycle on 2026-08-19).
  Killing the node kills its timers; only then is the store yours to write.
- **A completed day reopens AT ITS OWN DATE.** Clicking a done day's card
  reviews that session — `logDate` becomes the old session's date, not today.
  Anything keyed on "strictly before the date being logged" (the LAST TIME
  line, progression walks) then correctly hides or shifts, which looks like
  a bug in the sandbox and is not. To exercise "returning athlete" behavior,
  seed TWO weeks, log week 1's copy, and open week 2's — that is the real
  production shape (each week's exercise has its own id).
- **Clear localStorage fully when switching roles.** Leftover coach
  `trainerpro_data_v1` next to a seeded athlete `trainerpro_client_v1` boots
  the athlete screen in live-log/preview mode ("← Back to coach view"), where
  previews suppress athlete-only UI (the readiness ask, for one) and nothing
  looks wrong — it just quietly isn't the real athlete path.
- The home hero's "Start workout" label lives in a SPAN inside the button —
  match on any element's text, not `querySelectorAll("button")`.
- `pointer: coarse` blocks never apply in a desktop iframe — tap-target
  sizes from the end-of-file coarse pass can only be verified by reading the
  CSS, not by measuring in this sandbox.
- Media queries resolve against the iframe's CSS viewport, but a same-`?v=`
  stylesheet reload can come from the MEMORY cache even with no-store
  headers — cache-layer rule 2 applies to iframes too: bump the tag.

## Gotchas

- Never seed/mutate data on the user's real origin (localhost:5190) — their
  actual coach data lives in that localStorage.
- The mobile exercise-library modal (`#ex-library-overlay`) only gets its
  open button on narrow layouts; `resize_window` did not shrink the viewport
  in testing. To exercise the modal's real render path directly:
  `document.querySelector("#ex-library-overlay").classList.remove("hidden")`
  then dispatch an `input` event on `#ex-library-search`.
- Clicking two coach-nav targets back-to-back can race the re-render — click,
  screenshot, then click the next thing. This is worst right after a page
  load: clicks during the async boot get swallowed and the app lands back on
  Overview. Confirm each navigation with a screenshot before the next click.
- The service worker caches versioned assets cache-first by full URL. If you
  edit app.js/styles.css AGAIN mid-verification without bumping the `?v=`
  string in index.html again, the browser serves the stale file and your new
  code silently never loads. Bump `?v=` on every edit-retest cycle.
- The boot-click race (above) routinely swallows the FIRST 1–2 clicks after
  any navigate/reload — don't stack "reload, click nav, click card" in one
  batch. Reload → wait → screenshot → click → screenshot; expect to repeat a
  click that landed on a stale view.
- Seed dates in LOCAL time, never `new Date().toISOString()` — the app's
  `todayISO()` is local, and UTC drift makes "today" land on tomorrow after
  ~5pm local, which silently changes day-completion / streak / current-day
  behavior under test. Write literal `"YYYY-MM-DD"` strings or compute via
  `dateISO(new Date())`-equivalent locally in the seed snippet.
- The read-only "View as athlete" preview was retired 2026-07-17: the 🏋️
  button on an athlete card goes straight into the fully-interactive live
  session (`body.live-log-mode`), which lands on the athlete's current day
  in workout detail. Everything is clickable there — but the floating rest
  timer (bottom-right) overlays card controls near the viewport's bottom
  edge, so scroll a card's Skip/lock buttons clear of it before clicking.
- The Chrome window size varies between sessions — never reuse coordinates
  from an earlier session's screenshots; re-locate elements from a fresh
  screenshot first. Page ZOOM also changes between screenshots within a
  session, so coordinates go stale mid-task, not just between tasks. If two
  clicks in a row land wrong, stop using coordinates and drive by DOM.
- A roster row opens in place: `.client-row-main` toggles a strip of doors
  (Program / Nutrition / Sessions / Profile) inside the parent `.client-cell`,
  and only "Program" runs `openClient()`. Two traps when scripting it: the
  strip is NOT inside `.client-row`, so query from `.client-cell`; and because
  it toggles, a second `.click()` closes it again — check whether the doors
  are already there before clicking. Anything that needs a real
  `state.currentClientId` (Anatomy coverage, for one) has to go through that
  door, because the coach nav clears the id on the way to every top-level view.

## Progress shapes you will get wrong when seeding

Every one of these threw or silently rendered nothing on 2026-08-19. They are
not guessable from the field name, and `ensureProgressShape` does not repair
them because a wrong-typed value looks present.

| Field | Shape | Not |
|---|---|---|
| `dayCompletions[dayId]` | `["2026-08-17"]`, an ARRAY of dates | `true` |
| `workoutMoods[dayId]` | `{ date, moods: ["strong","energized"] }` | `["strong"]` |
| `readiness[dayId]` | `{ date, sleep, sore, stress }`, each 1-4 | a score |
| `addedExercises[dayId]` | array of full exercise objects | names |
| `exerciseLogs[exId][n]` | `{ date, locked: true, sets: [{weight, reps}], rir }` | |

`dayCompletions: { d1: true }` throws inside `dayFirstLogDate` and kills the
whole day-card render with an empty grid and one console exception. If a grid
comes back empty, read the console before assuming the feature is broken.

Readiness only counts when `readiness[dayId].date` EQUALS the log's date, and
RIR only reaches the engine on an entry with `locked: true` and at least as
many sets as prescribed.

## Driving the phone Back button

`history.back()` from `javascript_tool` is a faithful stand-in for the hardware
button, and the whole Nav stack ([[nav-back-button-levels]]) is testable that
way: assert the DOM between presses rather than screenshotting. Allow ~600ms
after each press; popstate handlers re-render.
