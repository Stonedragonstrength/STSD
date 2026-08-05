# tests

Plain Node scripts, no framework and no install. Run one directly:

```bash
node tests/session-bank.test.js
node tests/pull-from-day.test.js
```

Each exits non-zero if anything fails, so they work in a pre-push hook or CI
unchanged.

These are here because the logic they cover is the kind you cannot check by
looking at the screen: it is either arithmetic about money or a copy that
silently shares state. The functions are duplicated from `app.js` rather than
imported, because `app.js` is one big IIFE with no exports — so **if you change
the original, change the copy here too, or the test is guarding nothing.**

| File | Covers | Why it earns a test |
|---|---|---|
| `session-bank.test.js` | `bankLedger` — the monthly-allowance ledger | Decides what athletes owe. Month boundaries, the December-to-January roll, allowance-spent-before-a-bought-pack, over-redeeming, rollover on and off. |
| `pull-from-day.test.js` | the ⇄ Pull commit loop | Superset ids must be re-minted or two runs pulled from different days merge into one; `structuredClone` must be deep or the copy and the source share their `modifiers` array and editing one edits the other. |
| `auto-renew-size.test.js` | `runAutoRenewGrants` — what the monthly ticket is worth | The number the coach bills from. It used to be sized by counting bookings on the first app open of the month, so a 12-session athlete with three sessions on the calendar was billed $255 against a $1,020 membership, and athletes with an empty calendar got no ticket at all. Covers: the ticket is the membership, over/under booking never moves the price, the advisory count, and manual grants staying untouched. |
| `free-sessions.test.js` | birthday + referral grants, and what a free session is worth | Both passes run on every calendar load, so a missing idempotency guard hands out a session per page load — it doesn't throw and doesn't look wrong, the balance just climbs. Covers: fires once per year / once per referred person however often the pass runs, never before the day, lands late if the app wasn't opened, no back-granting a birthday typed months later, Feb 29, self-referral, deleted referrer — plus the ledger proof that a free package never expires, is spent only after the paid allowance, and never appears in what's owed. |
| `workout-clock.test.js` | `WorkoutClock` — how long a session is recorded as lasting | The summary said "24 minutes" after a 72-minute workout and nothing on screen said which was right. Three under-counts at once: gaps over the 5-min idle cap were discarded whole instead of credited up to it, `onVisible` re-stamped the clock so every screen-lock-during-rest vanished, and `enter()` zeroed the session so a trip to another tab restarted it. Covers: the cap credits rather than drops, no cliff at 5:00, screen-off rest counts, a long absence stays bounded, same-day re-entry continues and a different day starts fresh, and the per-commit 3-hour cap. |
