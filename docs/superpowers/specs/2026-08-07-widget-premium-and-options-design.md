# Android widget — premium look and more options

**Date:** 2026-08-07
**Status:** approved in outline, ready to plan

## The ask

The widget works. It should feel premium, and it should be adjustable — how far
ahead it looks, how dense the rows are, and what each row says.

## The constraint that shapes everything

**There is no local feedback loop.** The widget is compiled only by CI, and
every change costs a push, a build and a manual install on Nathan's phone —
that round trip has already cost ten builds once
([[stsd-android-widget-ships-via-ci]]). Nothing here can be tuned by looking at
it the way the web app was.

Two consequences, and they are design decisions rather than notes:

1. **Every visual choice is decided on paper first**, in this document, and
   changes land in ONE build rather than a sequence of nudges.
2. **Prefer mechanisms that cannot be subtly wrong.** A colour computed by a
   ported hash either matches the app or does not, and can be asserted in a
   unit test on the desktop. A hand-tuned gradient stop cannot.

## What exists today

- `ConfigActivity` with sign-in, an **accent** picker (8 accents, each with a
  neon and a deep variant) and a **light background** switch.
- `Theme.kt` — accents plus text/muted/surface colours per surface.
- `widget_row.xml` — a 52dp time column (time over duration) and a name column
  with an optional note line, hidden when there is no note.
- Every row's time is painted with the ONE chosen accent.
- `‹` / `›` step a week, this week is the floor, `NOW` returns.

---

# Part 1 — The premium look

## 1.1 The athlete's own colour, as a slim edge

Each row gains a **3dp left edge** in that athlete's own colour — the same
accent their avatar and roster card carry in the app, and the same one the day
list and week grid now use.

The chrome (header, day dividers, wordmark, the time text) keeps the coach's
**chosen accent**, so the widget still reads as one designed object rather than
a bag of colours. The edge alone carries "who".

**This is the piece with a real correctness requirement.** The widget currently
selects `id,start_at,end_at,note,status,athletes(display_name)` — it knows
athletes by NAME. The app's `athleteColorIdx()` hashes the athlete's **id**
(falling back to the name). Hashing the name in the widget would give every
athlete a different colour in the two places, which is worse than no colour at
all.

So:

- Add `athlete_id` to the bookings select.
- Port `athleteColorIdx` **exactly**: djb2 (`h = ((h << 5) + h + ch) | 0`),
  `abs(h) % 8`, over `id` falling back to `name`.
- Port the 8-colour palette from `AVATAR_COLORS` / `AVATAR_RGB` (both are 8
  entries; verified).
- A **unit test on the desktop** asserts the Kotlin hash and the JS hash agree
  for a fixed set of ids. This is the one part that can be proven without a
  phone, and it is the part most likely to be quietly wrong.

**Legacy `setmore_events` rows carry no athlete_id** — only `client_name`. They
fall back to the name hash and will not match the app. Setmore is switched off
([[stsd-scheduling-lives-in-two-tables]]) so this affects only historic rows;
it is accepted, not fixed.

No bitmap: a coloured edge is a `View` whose background is set with
`setInt(R.id.row_edge, "setBackgroundColor", colour)`, which is remotable.

## 1.2 A gradient wordmark

The header's "THIS WEEK" / date range becomes a **gradient wordmark**, rendered
once per widget update to a bitmap with a `LinearGradient` shader and set via
`setImageViewBitmap`.

**Exactly one bitmap.** `RemoteViews` cross a Binder transaction with a hard
size budget, and a bitmap per row would crash the widget on a busy week — which
is a category of failure that only shows up on the weeks that matter most. The
wordmark is the one element that earns it.

The gradient runs between the chosen accent's two stops, so it changes with the
accent picker rather than being a fixed rainbow.

## 1.3 A gradient surface, without a bitmap

The flat background becomes a **gradient panel**, as a drawable rather than a
bitmap.

It must not be baked per accent (8 accents × 2 surfaces = 16 drawables to keep
in step). Instead it is a **translucent black→transparent (dark) or
white→transparent (light) overlay** over the existing surface colour: accent
independent, one drawable per surface, and correct for any accent added later.

Plus rounded corners and slightly more breathing room around the list.

---

# Part 2 — The options

Three new settings, all in `ConfigActivity`, all stored in `Prefs`.

## 2.1 How far ahead

`Next 3 days` · `This week` (default, current behaviour) · `Next 14 days`.

**This interacts with the `‹` / `›` arrows, and the interaction has to be
chosen rather than discovered:** the arrows step by **the chosen span**, not
always by a week. On "next 3 days" they move 3 days; on "next 14" they move a
fortnight. The floor stays the same — the widget never pages into the past.

The header label follows the span: "THIS WEEK · 3–9 AUG" becomes "NEXT 3 DAYS ·
7–9 AUG". `Prefs.week()` becomes an anchor date plus a span rather than a week
start, and its "re-default when the stored week is in the past" rule applies to
the anchor.

## 2.2 Row density

`Comfortable` (default, as now) · `Compact`.

Compact drops the duration line and tightens the vertical padding, so an
ordinary session is a single short line. On the same home-screen area this is
roughly a third more sessions.

## 2.3 What each row shows

Independent toggles: **duration** and **notes**.

Both default on, which is exactly today's behaviour. Compact density forces
duration off; the toggle then reads as already-off rather than fighting it.

**Session balance is deliberately NOT offered.** The widget's `Booking` has no
balance on it and the bookings query cannot produce one — it would need a
second request per refresh against the athletes table. That is a real feature
with a real cost and it should be its own decision, not a checkbox smuggled in
here.

## 2.4 Background transparency

A slider, `Opaque` → `Glass`, defaulting to today's fully opaque panel.

Implemented as an alpha on the panel's background colour
(`setInt(root, "setBackgroundColor", …)` with the alpha channel set), NOT as a
view alpha: `View.setAlpha` would fade the **text and the edges with it**, which
is the one thing that must stay crisp. Only the surface moves.

**Two interactions that have to be decided here, not discovered on the phone:**

- **It compounds with the gradient panel (§1.3).** That overlay is itself
  alpha-based, so it is applied *within* the panel's own alpha rather than on
  top of it — otherwise the two multiply and "half transparent" lands nearer a
  quarter.
- **Contrast is the real risk.** Over a busy wallpaper, a near-glass panel can
  leave the muted text unreadable, and the widget has no way to know what is
  behind it. So the slider stops short of fully invisible, and the muted
  colours lift toward the main text colour as it approaches glass — the panel
  gets more transparent, the writing does not get harder to read.

## 2.5 Colour saturation

A slider, `Muted` → `Vivid`, defaulting to today's full-strength accents.

Applied by converting a colour to HSV and scaling S before use
(`Color.colorToHSV` / `HSVToColor`). It applies to **both** the chosen accent
and the per-athlete edge colours, so the whole widget desaturates together —
muting one and not the other would make the edges shout over a deliberately
quiet widget.

At the muted extreme the athlete edges converge toward grey and stop
distinguishing people. That is the coach's choice to make and the setting says
so, but it means the edge must never be the ONLY thing carrying meaning — which
it isn't: the name is right there.

`Theme.kt` already returns colours through accessors (`accentFor`,
`mutedColor`, `textColor`), so saturation is one transform applied at those
choke points rather than at every call site.

---

## 2.6 Reaching the settings at all

Today  opens once, when the widget is placed. Five settings
behind that are worthless — nobody removes and re-adds a widget to move a
slider. The widget header gains a **⚙** that opens the same screen.

That means the settings activity has TWO entry paths with different contracts:
placement (where a cancel means “do not place the widget” and a result must be
set) and direct (where the widget already exists and every change applies
immediately). They are told apart by whether the widget id is already known to
.

## Out of scope

- **Filtering which athletes appear.** Considered and not chosen.
- **Session balance on a row** (see above).
- Any change to sign-in, refresh cadence, or the two-source merge.

## Testing

Honest about what a desktop can and cannot prove:

**Can be tested without a phone**, and must be:
- the ported `athleteColorIdx` agrees with the JS one over a fixed id set
- span arithmetic: the anchor, the arrows stepping by span, the past floor,
  and the header label for each of the three spans
- density and row-content toggles select the right layout/visibility
- the saturation transform: full-strength is a no-op, muted is monotonic
  toward grey, and hue is never shifted
- the transparency ramp: alpha lands on the background colour and never on the
  view, and muted text lifts as the panel approaches glass

**Cannot be tested without a phone**, and needs Nathan on the build:
- whether the gradient wordmark reads well at widget scale
- whether a 3dp edge is visible against a wallpaper
- whether compact density is actually readable at arm's length
- where the transparency slider stops being usable over a real wallpaper —
  the one setting whose right answer genuinely cannot be reasoned out
- that no busy week trips the RemoteViews size budget

That second list is why this is one build and not five. The first list is what
makes one build a reasonable bet.
