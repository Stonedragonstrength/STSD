# Cloud-authoritative sync, offline-capable

**Date:** 2026-08-11
**Asked for as:** "I think it would be better to just go cloud based instead of
having an offline mode" — driven by a real incident: a filled day for Elise
Worthy read as permanently gone across reloads. Production forensics showed
the data was never lost; the app **renders before the pull lands**, and the
work most likely missing from the local paint is precisely the last work done.

**Decision:** not cloud-only — cloud-**authoritative**. The cloud becomes the
boss; localStorage demotes to cache + offline write queue. Gym-floor logging
with no signal keeps working. Nathan approved the four-piece design and the
concurrency policy (merge what merges, guard what doesn't) in conversation.

## What the code actually does today (verified map, 7-agent sweep + cross-check)

- **Coach boot** pulls `coaches` + `athletes` rows *before* first render
  (app.js:37131-47) — but **progress rows arrive after first paint** via
  `refreshAllAthletePackages` (app.js:23385) and per-athlete
  `pullProgressFromCloud` (app.js:5747, fire-and-forget). Logged sets are the
  late rows. That's the whole incident.
- **Nothing ever re-pulls an idle screen**: zero focus/visibility pull
  listeners, zero realtime usage, zero pull timers. `visibilitychange`/
  `pagehide` only *flush pushes* (37083/37086) — and the hide path *originates*
  a write (WorkoutClock commit).
- **Writes are unconditional whole-row upserts**: `upsertAthlete`
  (cloud.js:636) and `upsertProgress` (cloud.js:1158). `updated_at`/`synced_at`
  are stamped by the client at push time and **compared by nothing** — the
  columns are write-only. Server-side last-write-wins, always.
- **Merge-on-pull** exists only coach-side (`populateCoachFromCloud`,
  app.js:3804): per-athlete boolean dirty flags decide whole-object cloud-vs-
  local; `inboxClearedAt` (Math.max) is the sole freshest-wins comparison in
  the app.
- **Failures are silent**: `getProgress` catch returns null indistinguishable
  from "no news" (cloud.js:1177); debounced push rejections are warned and
  dropped with no retry (cloud.js:1280-83).
- **Hazards found en route** (cross-check): a `pagehide` sign-out
  (app.js:36672) races the final flush when "Remember me" is off — unflushed
  logs unrecoverable; `postBulletin`/`removeBulletin` fire un-guarded
  whole-roster athlete upserts; two tabs on one device share nothing and
  last-tab-wins; a stale cached build can whole-row-upsert with dropped JSON
  keys (the old-clients-read-old-fields problem, structural).
- Realtime is **loaded and unused**: the CDN UMD bundle ships RealtimeClient;
  `sb.channel()` exists on the client built at cloud.js:25.

## The four pieces

### 1. Never show stale data as settled truth (client only)

A `SyncStatus` module + a header chip in both roles (coach: inside
`.header-right`, index.html:209ff; athlete: index.html:1125ff — chip recipe
from `.header-sessions`, styles.css:736; state colors from the theme-stable
`--warn-rgb`/`--danger-rgb` channels, never hex; the white theme and the ten
dark ones all inherit correctly by construction).

States, in priority order: **syncing** (any pull or push in flight/queued) →
**issue** (last operation failed; tap retries) → **offline** (`!navigator.onLine`
or Cloud disabled: "logging saved on this device") → **up to date ✓**.

Feeds: cloud.js's debounce/flush instrumented to report queue transitions
(`Cloud.onSyncActivity(cb)`) and every silent catch upgraded to also report
through the same hook. app.js marks pull start/end around the boot pull,
`refreshAllAthletePackages`, `pullProgressFromCloud`, `refreshCoachSchedule`.
During a live session the athlete header-right is hidden (styles.css:10104),
so the live pill (`#preview-banner`) carries a sync dot with the same states.

### 2. Re-pull on focus and reconnect (client only)

`visibilitychange→visible`, `window focus`, and `online` run `resyncNow()`,
throttled to once per 20s: **flush pending pushes first, await, then pull**
(push-then-pull ordering so a device's own fresh work is never overwritten by
its own stale pull). Coach: `getCoachByAuthUserId` → `populateCoachFromCloud`
(existing dirty-flag protection) + `pullProgressFromCloud` for the open
athlete + `refreshLiveProgram()` when in a live session. Athlete:
`getAthleteByAuthUserId` → apply program + progress → re-render the visible
view. One `rerenderAfterSync()` helper dispatches on the visible screen/tab.

Also fixed here because it's load-bearing for "flush on exit": the
`pagehide` sign-out at app.js:36672 flushes before it signs out.

### 3. Server groundwork (one migration, deployed BEFORE any client change)

- `athletes.rev bigint default 1` + trigger `rev = rev + 1`, and a trigger
  stamping `updated_at = now()` server-side (client stamps stop mattering).
- `merge_progress(p_athlete_id, p_payload jsonb, p_base_rev bigint)` RPC:
  inserts when absent; otherwise merges **exercise_logs entry-by-entry** —
  per exercise id, union entries by entry id; both sides carrying the same
  entry id → higher `m` (client-stamped ms, absent = 0) wins. Every other
  field: payload wins (today's semantics — they are preferences and
  containers, not the catastrophic-loss family). Returns the merged row +
  new rev. `progress.rev bigint` + trigger, same as athletes.
- `alter publication supabase_realtime add table athletes, progress` so
  postgres_changes (RLS-respecting) can feed piece 4's subscriptions.

### 4. Guarded writes, merged writes, realtime (client)

- **Program row (single author, guard):** client keeps `_rev` per athlete
  (rowToAthlete currently discards it). `upsertAthlete` becomes a guarded
  update (`eq('rev', base)`); 0 rows = conflict → re-pull, re-merge through
  the dirty-flag path, **one** replay on the new rev; a second conflict
  surfaces on the sync chip. A stale device can no longer silently clobber —
  today's whole incident class, closed.
- **Progress row (many writers, merge):** all `upsertProgress` callers move
  to the `merge_progress` RPC. Entry writers (lockIn, autosave persist, the
  skip writer, cardio, mobility rounds) stamp `m: Date.now()` on entries —
  additive; old builds ignore it and age out fast (HTML is network-first, so
  a fresh deploy reaches every online open).
- **Realtime:** `Cloud.subscribeSync(...)` — coach subscribes to `athletes`
  (`coach_id=eq`) + the open athlete's / live-session athlete's `progress`
  row; athlete subscribes to their own `athletes` + `progress` rows. Events
  apply through the same populate/apply paths and `rerenderAfterSync()`;
  incoming `rev <= known rev` is the self-echo/no-news skip. Reconnects
  re-run `resyncNow()`.
- Athlete additions (`athleteDays`, `addedExercises`) live in the progress
  row and are untouched by the program guard — the features were already on
  the correct side of the line. Their families merge payload-wins per day
  key, so a deletion sticks and a stale device cannot resurrect it.

## Ship order

Stage 1 = pieces 1+2 (pure client, immediate UX win, zero server risk).
Stage 2 = piece 3 migration (db push, verified via begin/rollback probes),
then piece 4's guarded/merged writes. Stage 3 = realtime. Full suite + jsdom
harnesses green at each stage; each stage is its own deploy.

## Testing

- SQL: `merge_progress` exercised against production inside
  begin/rollback — entry union, same-id newer-m wins, delete-not-resurrected
  for payload-wins families, insert-when-absent, rev bump.
- Node/jsdom: sync chip state transitions (mock Cloud with controllable
  latency/failure); focus resync ordering (flush before pull — assert by
  call order); conflict path (guarded write returns conflict → repull +
  single replay); realtime apply → re-render of the visible view; the
  pagehide flush-before-signout ordering.
- Live: two-device fill (desktop + phone) on a test athlete; kill wifi
  mid-log on the athlete side and watch the chip go offline → reconnect →
  merge with nothing lost.

## Not doing

- No CRDT/operational transform for program structure — one author + guard +
  realtime makes true simultaneous program edits rare, refused, and visible.
- No roster-wide progress realtime (no coach_id on progress rows; focus
  re-pull covers the roster surface).
- No offline UI beyond the chip — offline logging already works and stays.
- Cross-tab (two tabs, one device) reconciliation: out of scope; noted as a
  known hazard in the map. Realtime narrows it (both tabs receive pushes);
  a `storage`-event listener is a candidate follow-up.
