# Stone Dragon Strength Training — CLAUDE.md

## What this is
A coach-athlete strength training manager. Coaches design programs and track athletes; athletes view workouts, log progress, and send it back. Deployed as a static PWA at `sleeperhomes.com`.

## Tech stack
- Vanilla HTML/CSS/JS — no framework, no bundler, no build step
- Supabase JS v2 (CDN) — the only external dependency
- localStorage is the source of truth; Supabase is optional cloud sync
- PWA (installable on mobile via manifest.json)

## File map
| File | Role |
|---|---|
| `app.js` | Everything: state, auth, rendering, event handlers (~2000+ lines, one IIFE) |
| `index.html` | All markup — screens/panels toggled via `.hidden` class by `app.js` |
| `styles.css` | All styles — dark theme, CSS custom properties defined in `:root` |
| `cloud.js` | Supabase sync layer — maps in-memory objects ↔ DB rows, debounced pushes |
| `config.js` | Supabase URL + anon key (public by design) |

## Architecture patterns

### Screen/panel model
Three top-level `<section>` screens: `#screen-login`, `#screen-app` (coach), `#screen-client` (athlete). Only one is visible at a time via `show()`/`hide()` helpers that toggle `.hidden`. Within each screen, sub-panels (tabs, views) work the same way.

### State
Single `state` object loaded from localStorage at boot:
- `state.trainerData` — coach + all athletes (`KEY_TRAINER = "trainerpro_data_v1"`)
- `state.clientData` — athlete's local program + progress (`KEY_CLIENT = "trainerpro_client_v1"`)
- `state.currentClientId` — which athlete the coach is editing

### Saving
`saveTrainer()` writes `state.trainerData` to localStorage and debounce-pushes the current athlete to Supabase. `saveClient()` does the same for athlete progress. Always call these after mutating state.

### DOM helpers
`$()` = `querySelector`, `$$()` = `querySelectorAll` returning an array. `show(el)`/`hide(el)` toggle `.hidden`.

### Data shapes
```
client → { id, name, inviteCode, weeks[], schedule{}, coachPRs[], sessionBank{packages[], redemptions[]}, importedProgress }
week   → { id, label, focus, phaseLabel, days[], diet{calories, protein, notes} }
day    → { id, name, exercises[] }
exercise → { id, name, sets, currentWeight, currentReps, goalWeight, goalReps, notes, videoUrl }
progress → { exerciseLogs{}, bodyweightLog[], dayCompletions{}, personalRecords[], feedback }
```

### Cloud sync (cloud.js)
Supabase tables: `coaches`, `athletes`, `progress`, `athlete_profiles`. All cloud calls fail silently — offline always works. Debounce key pattern: `"athlete:<id>"` / `"progress:<id>"`.

## Auth
- **Coach gate**: shared hardcoded code `SD253` stored in sessionStorage — casual deterrent only, not real security
- **Coach login**: PIN hashed client-side with a simple djb2-style hash; hash stored in localStorage, never synced to cloud
- **Athlete first login**: invite code (`XXXX-XXXX` format, omits 0/O/1/I) fetched from Supabase by `Cloud.getAthleteByInviteCode()`
- **Athlete return login**: local password (same hash), stored in `state.clientData.profile`

## Key UI flows
- **Coach adds athlete** → `makeClient()` → push to `state.trainerData.clients` → `saveTrainer()` → cloud upsert
- **Coach shares athlete** → `encodeData()` base64-encodes the athlete object → coach copies code → athlete pastes it
- **Athlete sends progress** → `encodeData()` encodes progress → athlete copies → coach pastes via "Import progress"
- **Athlete invite code** → short code stored on Supabase; athlete enters it, app does `Cloud.getAthleteByInviteCode()`

## Local dev
```bash
python3 -m http.server 5190 --directory .
# then open http://localhost:5190
```
No install, no build. Just open `index.html` or serve over HTTP.

## Conventions
- Cache-busting via `?v=` query strings on script/style tags in `index.html` — bump manually on deploy
- `uid()` generates IDs: `Date.now().toString(36) + random`
- `todayISO()` / `dateISO()` / `parseISO()` handle dates as `YYYY-MM-DD` strings
- `escapeHtml()` is used whenever rendering user content into innerHTML
- Migration logic lives inline in the boot sequence (backfilling new fields on old data shapes)
