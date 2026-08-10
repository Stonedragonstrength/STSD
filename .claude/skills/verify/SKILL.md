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
