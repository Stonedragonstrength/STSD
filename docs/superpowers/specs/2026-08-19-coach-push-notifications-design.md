# Coach push notifications

**Status:** approved 2026-08-19. Nathan asked for "a gamut of options in the
profile area", naming booking changes, someone logging an exercise day, and
someone messaging him, plus "any other smart ones you can think of". He chose
three modes per category over a plain on/off, all four category groups, and
building the whole thing rather than phasing it.

## The problem

The coach receives exactly one push today: a booking request, via
`notify-coach`. There is no coach preferences table. The Profile toggle is
subscribe-or-not, so the only two states are "one notification" and "none".

Two facts constrain everything below.

**An athlete must never be able to write text onto the coach's lock screen.**
`notify-coach` says so in its header and enforces it by taking an id and
nothing else, composing the title and body on the server from the rows. Every
new athlete-triggered notification follows that rule.

**The coach has a roster.** An athlete has one coach, so on/off per category
works for them. Twenty-eight athletes logging workouts is fifteen to twenty
pushes a day, which is a feature the coach switches off inside a week. Volume
is the design problem, not plumbing.

## Modes

Every category is `off`, `instant`, or `digest`.

`digest` collects into one push per day at a time the coach picks. `instant`
sends immediately, except during quiet hours.

**Quiet hours DEFER rather than drop.** The athlete side drops a push that
lands inside quiet hours. For the coach that would lose a failed card charge
overnight, so instead an instant notification arriving inside quiet hours is
queued and flushed the moment quiet hours end. Nothing is lost, nothing buzzes
at 2am, and no category needs an "urgent, ignore quiet hours" exception.

## Categories

17 kinds in 4 groups. "Row" means a real table verifies the event; "progress"
means the event is verified against the athlete's `progress` jsonb while the
WORDS come from the coach's own copy of their program.

| Kind | Group | Source | Default |
|---|---|---|---|
| `workout_logged` | Training | progress | digest |
| `pr_set` | Training | progress | digest |
| `day_skipped` | Training | progress | digest |
| `readiness_low` | Training | progress | instant |
| `session_note` | Training | progress | digest |
| `athlete_quiet` | Training | cron | digest |
| `message` | Talking | row `messages` | instant |
| `form_check` | Talking | row | instant |
| `invite_claimed` | Talking | row `athletes` | instant |
| `bug_report` | Talking | row `bug_reports` | instant |
| `booking_request` | Schedule | row `booking_requests` | instant |
| `booking_made` | Schedule | row `bookings` | instant |
| `booking_cancelled` | Schedule | row `bookings` | instant |
| `balance_zero` | Schedule | server | instant |
| `payment_in` | Money | server | digest |
| `charge_failed` | Money | server | instant |
| `month_uncollected` | Money | cron | digest |

`readiness_low` is instant because it is only useful before the session it
describes. `charge_failed` is instant because Square is live and real money
already moved.

## Storage

### `coach_prefs`

One row per coach.

- `coach_id uuid primary key references coaches(id) on delete cascade`
- `notify_modes jsonb not null default '{}'::jsonb` (kind to mode; anything
  absent falls back to the table above, resolved in code)
- `tz text not null default 'America/Los_Angeles'`
- `digest_at time not null default '19:00'`
- `last_digest_on date`
- `quiet_on boolean not null default true`
- `quiet_from time not null default '21:00'`
- `quiet_to time not null default '07:00'`

`notify_modes` is jsonb rather than 17 columns so a new category is a code
change instead of a migration plus a `rows.js` mapping. The scalar columns are
real columns because the digest cron filters on them in SQL.

RLS: a coach reads and writes their own row only. The Edge Functions use the
service role.

### `coach_notice_queue`

- `id bigint generated always as identity primary key`
- `coach_id uuid not null references coaches(id) on delete cascade`
- `kind text not null`
- `title text not null`
- `body text not null`
- `url text`
- `deferred boolean not null default false` (an instant that hit quiet hours)
- `created_at timestamptz not null default now()`
- index on `(coach_id, created_at)`

Rows are deleted as they are sent. Nothing here is a record; it is an outbox.

## Delivery

`supabase/functions/_shared/coach-notify.ts`:

```
deliverToCoach(sb, coachId, kind, { title, body, url }) -> "sent" | "queued" | "muted"
```

It resolves the mode, and:

- `off`: returns `muted`.
- `digest`: inserts into the queue, returns `queued`.
- `instant`, inside quiet hours: inserts with `deferred = true`, returns
  `queued`.
- `instant`, otherwise: reads the coach's `push_subscriptions` rows and sends,
  returns `sent`.

Every path that wants the coach's attention goes through this one function, so
mute and quiet hours cannot be bypassed by a caller that forgot.

## Entry points

**Athlete-triggered.** `notify-coach` grows from `{ requestId }` to
`{ kind, refId }`. It authenticates the caller as an athlete, confirms the
athlete belongs to the coach, dispatches to the recipe for that kind, and hands
the composed text to `deliverToCoach`. Recipes live in
`_shared/coach-recipes.ts`, one small function each, all of them taking
`(sb, athlete, refId)` and returning `{title, body, url}` or null.

The existing freshness guard stays and generalises: an event older than two
minutes is stale and sends nothing, which is what stops a replayed id becoming
a stream of notifications.

**Server-triggered.** The Square webhook, the reconcile job, and the crons call
`deliverToCoach` directly with the service role. There is no caller to verify
because there is no caller.

**Correction, found while checking whether the coach had setup to do
(2026-08-19).** No Square dashboard change is needed: the subscription already
covers every event the money categories want, and it is provably live, with 21
events received. But `billing_events` holds only `payment.updated` (18) and
`payment.created` (3). There has never been a single `invoice.payment_made` or
`invoice.scheduled_charge_failed`, because the money arrives as card charges
rather than Square invoices.

So `charge_failed` must hang off a FAILED `status` on `payment.updated`, which
that handler already reads, and NOT off `invoice.scheduled_charge_failed` as
assumed above. Wiring it to the invoice event would have shipped a
notification that could never fire, and nothing would have reported it.

## The digest

`supabase/functions/coach-digest`, on pg_cron every 15 minutes, the same
pattern as the four crons already scheduled. Two jobs in one pass:

1. **Flush deferred instants.** For any coach no longer inside quiet hours,
   send their `deferred = true` rows and delete them.
2. **Daily digest.** For any coach whose local time has passed `digest_at` and
   whose `last_digest_on` is not today, collapse their non-deferred queue rows
   into one push, delete them, and stamp `last_digest_on`.

The digest body groups by kind with counts and names: "6 sessions logged:
Kristyn, Cheryl, Dan and 3 more. 2 PRs. 1 skip." Tapping it opens the coach
Overview.

`athlete_quiet` and `month_uncollected` are derived rather than evented, so the
same cron pass computes them before building the digest.

## Client

### cloud.js

- `getCoachPrefs(coachId)` / `saveCoachPrefs(coachId, patch)`, mirroring the
  athlete pref helpers.
- `notifyCoach(kind, refId)` replacing `notifyCoachOfRequest`, which becomes a
  one-line wrapper so no existing call site breaks in the same commit.

### app.js

A `🔔 Notifications` fold in the coach Profile, using the existing
`.pref-fold` pattern. Inside, four labelled sections rather than nested
collapsibles, each row a name and a three-way segmented control reusing the
segmented grammar the app already has. Below the sections: quiet hours,
digest time, and a **Send me a test** button, because there is otherwise no way
to tell from the phone whether any of it works.

The master subscribe toggle stays where it is and gains a line saying what it
governs.

### Event wiring

Athlete-side call sites get one `Cloud.notifyCoach(kind, id)` each, fired after
the write that the server will verify against. Coach-side and cron-side call
`deliverToCoach`.

## Testing

The mode resolution, the quiet-hours window (including the wrap past midnight),
and the digest grouping are pure functions and get unit tests. The recipes are
verified by hand against a seeded athlete. There is no way to unit test a real
push, so the **Send me a test** button is the acceptance check.

## Risks

- **Volume.** If the defaults are wrong the coach turns everything off. Hence
  digest defaults on everything routine.
- **Silent failure.** Push already fails silently by design. The test button is
  the only honest signal, so it ships in the same change as the settings.
- **Key rotation.** Rotating VAPID keys kills every subscription. Unchanged by
  this work, but it now affects more than one notification.
