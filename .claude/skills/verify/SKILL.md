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
  screenshot, then click the next thing.
