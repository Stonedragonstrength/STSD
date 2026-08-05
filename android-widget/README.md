# Stone Dragon Schedule — Android widget

A home-screen widget showing the coach's booked sessions, one day at a time.
Coach-only and Android-only by design; iOS home-screen widgets need a native
app through the App Store, which this is not.

## What it shows

```
┌──────────────────────────────────────┐
│  ‹   TODAY · TUE 4 AUG   ›   NOW  ⟳  │
├──────────────────────────────────────┤
│  6:00a   Sarah M.                    │
│          60m                         │
│  7:00a   Mike T.                     │
│          45m · bring the belt        │
│  4:00p   Jess R.                     │
│          60m                         │
└──────────────────────────────────────┘
```

- `‹` / `›` step a day. Today is the floor — it will not page into the past.
- Tapping the date jumps back to today.
- `⟳` refetches.
- Tapping a row opens the web app.
- Finished sessions dim rather than disappear, so the shape of the day stays.

## How it gets its data

One PostgREST call per day view:

```
GET /rest/v1/bookings
    ?select=id,start_at,end_at,note,athletes(display_name)
    &status=eq.booked
    &start_at=gte.<local midnight, as UTC>
    &start_at=lt.<next local midnight, as UTC>
    &order=start_at.asc
```

There is **no `coach_id` filter and no Edge Function**. The `coach manages own
bookings` RLS policy (`supabase/migrations/20260729140000_scheduling.sql`)
already scopes the table to whoever is signed in, and the athlete's name rides
along through the `bookings.athlete_id -> athletes.id` foreign key. Adding a
filter here would only be a second place to get it wrong.

This means the widget needs nothing deployed to Supabase. It reads what the web
app already writes.

## Building

You do not need Android Studio. Push to `main` and
`.github/workflows/android-widget.yml` builds the APK and republishes it to a
fixed release tag, so the download URL never changes and never expires:

**https://github.com/Stonedragonstrength/STSD/releases/latest/download/stone-dragon-schedule.apk**

Artifacts are still uploaded per run for debugging, but they expire after 90
days, need a GitHub login, and sit at a different URL each time — the release is
the link to keep.

Locally, if you do have a JDK 17 and Gradle 8.7:

```bash
cd android-widget
gradle assembleDebug
# app/build/outputs/apk/debug/app-debug.apk
```

## Installing

1. Open the release link above on the phone. It downloads the APK directly — no
   zip, no login.
2. Tap it. Android will block it once and offer a settings toggle; allow
   "install unknown apps" for whichever app you tapped from, then tap again.
3. Open **Stone Dragon Schedule** from the app drawer and sign in with the coach
   email and password — the same pair as the web app.
4. Long-press the home screen → Widgets → Stone Dragon · Today.

The widget can also be placed first: it will read "Tap to sign in" until you do.

## Things worth knowing

- **Refresh is throttled by Android.** `updatePeriodMillis` will not go below 30
  minutes no matter what is asked for. `⟳` and every day-step fetch immediately,
  which is what covers the gap. If near-live matters more later, the next step is
  `WorkManager` (15-minute floor) or an FCM nudge.
- **The session is stored in plain app-private SharedPreferences**, not
  `EncryptedSharedPreferences`. On a non-rooted device no other app can read it,
  and avoiding Tink keeps the dependency list at "AndroidX and coroutines". That
  trade is fine for a sideloaded build on the coach's own phone and should be
  revisited before it goes to anyone else. The password itself is never stored —
  only the refresh token Supabase issues.
- **The anon key is compiled into the APK.** That is the same key `config.js`
  serves to every browser; it is public by design, and RLS is what does the
  actual work.
- **The widget shares nothing with the PWA.** Different process, different
  storage. It cannot read the web app's `localStorage`, which is why it
  authenticates separately.
