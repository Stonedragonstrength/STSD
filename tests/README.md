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
