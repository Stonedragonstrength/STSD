# Apple Health in-path — design

Approved by Nathan 2026-08-19 ("2 and 1"): an ongoing Shortcuts-webhook sync
plus a one-time history import from the Health app's export file. Metrics v1:
**bodyweight** (→ `progress.bodyweightLog`) and **workouts/cardio**
(→ `progress.cardioLogs`). Steps and sleep are deliberately out until they
have a home in the app.

## The constraint that shapes everything

HealthKit has no web API — the PWA can never read Apple Health directly.
Data must be pushed *to* us from the phone (Shortcuts automation) or carried
*by hand* (the Health app's export file). Both land in the same two progress
fields through the same merge functions.

## Why an inbox table, not a direct progress write

`merge_progress` replaces whole columns (`bodyweight_log = coalesce(payload,
existing)`); only `exercise_logs` gets entry-level union. If the Edge Function
wrote weigh-ins straight into the progress row, the athlete's next app-side
push — built from local state that predates those weigh-ins — would wipe them.
So the webhook writes to **`health_inbox`**, a mailbox keyed by athlete, and
the athlete's own app drains it on boot: merge locally (the same dedupe the
Renpho import uses), `saveClient()`, delete the consumed rows. localStorage
stays the source of truth; the cloud row only ever receives data the device
has already absorbed.

## Part A — webhook (ongoing sync)

- **Migration `20260819150000_health_inbox.sql`** (applied to live BEFORE the
  code ships): `athletes.health_token text` (unique where not null) +
  `health_inbox(id, athlete_id → athletes, kind, payload jsonb, created_at)`.
  RLS: athlete may select/delete own rows; nobody inserts through RLS — the
  Edge Function uses the service role.
- **Edge Function `health-sync`** (config.toml `verify_jwt = false`, the
  square-webhook precedent — Shortcuts has no Supabase JWT; auth is the
  athlete's token): POST `{ token, weights?, workouts? }` → look up athlete by
  token, clamp array sizes, insert ONE inbox row `{kind:"health-batch"}`.
  Expected failures (unknown token, empty batch) return 200 with `ok:false`
  per the edge-function-error-bodies rule.
- **cloud.js**: `getMyHealthToken` / `setMyHealthToken` (athlete's own row —
  existing RLS already permits), `pullHealthInbox` / `deleteHealthInbox`.
- **app.js**: an "Apple Health" pref-fold in the athlete Profile — Connect
  generates a token (`ht_` + 24 hex), saves it, and shows the endpoint URL +
  token with copy buttons; Disconnect clears it. The inbox drain runs on
  athlete boot/sign-in after the progress pull.
- **The Shortcut itself** is built once by Nathan on his iPhone from a recipe
  (Find Health Samples → build dictionary → Get Contents of URL POST), shared
  as an iCloud link with an Import Question for the athlete's token. Apple
  only allows Health reads while the phone is unlocked, so the daily
  automation fires at next unlock — near-daily in practice.

## Part B — history import (export file)

- Lives inside the same Apple Health fold: upload `export.zip` (minimal
  store/deflate zip reader via `DecompressionStream`) or the bare
  `export.xml`.
- The XML can run to hundreds of MB, so no DOMParser: the file streams
  through an incremental scanner (`makeHealthXmlScanner()`, top-level for
  load-fn extraction) that regex-matches `<Record
  type="HKQuantityTypeIdentifierBodyMass" …>` and `<Workout …>` elements
  across chunk boundaries via a carry buffer.
- BodyMass → weigh-ins (kg→lb, sample-local date+time); Workout → cardio
  entries (HK activity type mapped onto the app's CARDIO_TYPES names where
  known, cleaned name otherwise; duration → minutes, totalDistance → miles).

## Shared merge layer

- `mergeScaleEntries` gains a `source` parameter ("renpho" stays the
  default); webhook and importer pass "apple-health". Dedupe: date + time.
- New `mergeCardioEntries(log, entries)`: dedupe on `srcId` (Apple workout
  UUID) when present, else date+type+minutes.
- New `applyHealthPayloads(progress, payloads)`: one function both the inbox
  drain and (post-parse) the importer call.

## Testing

`tests/health-import.spec.js` extracts the real scanner + merge functions via
load-fn: records split across chunks, kg and lb units, workout mapping,
dedupe on re-import, inbox payload application. Edge Function logic stays
thin enough that its correctness rests on the token lookup + insert, verified
against the live function after deploy.
