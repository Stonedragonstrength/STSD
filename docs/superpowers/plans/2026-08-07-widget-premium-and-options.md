# Widget Premium Look & Options — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Android widget the athlete's own colour per row, a gradient wordmark and surface, and five new settings — span, density, row content, transparency, saturation.

**Architecture:** All colour decisions funnel through `Theme.kt` accessors so saturation is one transform at a choke point, not a change at every call site. All preferences go through `Prefs`. The row edge is a plain `View` background (no bitmap); only the wordmark is a bitmap, because `RemoteViews` cross a size-limited Binder transaction.

**Tech Stack:** Kotlin, Android `RemoteViews` app widget, `minSdk 26`, Gradle Kotlin DSL, no third-party UI libraries.

## Global Constraints

- **There is NO local JVM.** No `java`, no `gradle`, no wrapper on this machine. Kotlin here cannot be compiled, run, linted or unit-tested locally. **CI is the only compiler.** Every syntax error costs a CI round trip (~2–3 min, no phone install). Write defensively and re-read before pushing.
- **CI currently runs `assembleDebug` then `lintDebug` only.** Task 1 adds unit tests and a CI step, and every later task's tests run there.
- Widget UI is `RemoteViews`: only remotable methods work. `setInt(id, "setBackgroundColor", c)`, `setTextColor`, `setTextViewText`, `setViewVisibility`, `setImageViewBitmap`, `setFloat(id, "setAlpha", f)` are available. Arbitrary custom views, shaders on TextViews, and data binding are NOT.
- **Ration bitmaps.** One per widget update, total. A bitmap per row will exceed the Binder transaction limit on a busy week and crash the widget.
- **`<Switch>` in a layout inflates as `SwitchCompat` under AppCompat**, which is NOT a subclass of `android.widget.Switch`. Always `findViewById<android.widget.CompoundButton>`. This is already commented at `ConfigActivity.kt:98`; the same applies to any new toggle.
- `minSdk 26` — `SeekBar` is fine; `Slider` (Material) is available but adds no value over `SeekBar` here.
- Prefs are **per-app**, not per-widget, except `week`/`jump`/cache which are keyed by widget id. Follow that split: the five new settings are app-wide, the span ANCHOR stays per-widget.
- Never hardcode a colour that the accent or surface should decide; go through `Theme`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `app/build.gradle.kts` | Modify | Add JUnit test dependency |
| `.github/workflows/android-widget.yml` | Modify | Run unit tests before assembling |
| `app/src/test/java/.../AthleteColorTest.kt` | Create | The ported hash matches the web app |
| `app/src/test/java/.../ThemeTest.kt` | Create | Saturation + transparency maths |
| `app/src/test/java/.../SpanTest.kt` | Create | Span arithmetic, arrows, floor, labels |
| `Theme.kt` | Modify | Athlete palette + hash; saturation transform |
| `Prefs.kt` | Modify | Five new settings; anchor replaces week |
| `Supabase.kt` | Modify | Select `athlete_id`; carry it on `Booking` |
| `ScheduleWidgetService.kt` | Modify | Row edge colour, density, row content |
| `ScheduleWidget.kt` | Modify | Span paging, header label, wordmark, panel |
| `widget_row.xml` | Modify | Add the 3dp edge view |
| `widget_schedule.xml` | Modify | Panel background id for alpha |
| `activity_config.xml` | Modify | Five new controls |
| `ConfigActivity.kt` | Modify | Wire them |
| `res/values/strings.xml` | Modify | New copy |
| `res/drawable/panel_gradient*.xml` | Create | Accent-independent surface gradient |

---

## Task 1: Make CI able to fail fast

Nothing else in this plan can be verified without this. It must come first.

**Files:**
- Modify: `android-widget/app/build.gradle.kts`
- Modify: `.github/workflows/android-widget.yml`
- Create: `android-widget/app/src/test/java/com/stonedragon/schedule/SanityTest.kt`

**Interfaces:**
- Consumes: nothing
- Produces: a working `gradle testDebugUnitTest` in CI. Every later task adds tests to this tree.

- [ ] **Step 1: Add the test dependency**

In `app/build.gradle.kts`, in `dependencies`:

```kotlin
    // JVM unit tests only — there is no local JVM on the dev machine, so these
    // run in CI. They exist to catch the things a phone screenshot cannot:
    // arithmetic, hashes, and colour maths.
    testImplementation("junit:junit:4.13.2")
```

- [ ] **Step 2: Write a sanity test that must pass**

Create `app/src/test/java/com/stonedragon/schedule/SanityTest.kt`:

```kotlin
package com.stonedragon.schedule

import org.junit.Assert.assertEquals
import org.junit.Test

/** Proves the unit-test source set is wired and running in CI. */
class SanityTest {
    @Test
    fun testsRun() {
        assertEquals(4, 2 + 2)
    }
}
```

- [ ] **Step 3: Run the tests in CI, before the build**

In `.github/workflows/android-widget.yml`, immediately BEFORE the `Build debug APK` step:

```yaml
      - name: Unit tests
        working-directory: android-widget
        run: gradle testDebugUnitTest --no-daemon --stacktrace
```

Before the build, deliberately: a failing hash or a broken span calculation should stop the job before it spends time assembling an APK nobody should install.

- [ ] **Step 4: Push and confirm CI goes green**

```bash
git add android-widget/app/build.gradle.kts .github/workflows/android-widget.yml android-widget/app/src/test
git commit -m "Run widget unit tests in CI

There is no JVM on the dev machine, so CI is the only place Kotlin can
be compiled or tested. Tests run before assembling, so a broken hash
stops the job before it builds an APK."
git push origin main
gh run watch
```

Expected: the `Unit tests` step passes and the APK still builds. **Do not proceed until this is green** — every later task's verification depends on it.

---

## Task 2: The athlete's colour, ported exactly

**Files:**
- Modify: `Theme.kt`
- Modify: `Supabase.kt`
- Create: `app/src/test/java/com/stonedragon/schedule/AthleteColorTest.kt`

**Interfaces:**
- Consumes: Task 1's test set-up
- Produces: `Theme.athletePalette: IntArray` (8 entries), `Theme.athleteColorIdx(key: String): Int`, `Theme.athleteColor(id: String, name: String): Int`. `Booking` gains `athleteId: String`.

- [ ] **Step 1: Write the failing test with known-good values**

These expectations were computed by running the web app's own `athleteColorIdx` over these exact keys, so they encode the app's behaviour rather than a re-derivation.

Create `app/src/test/java/com/stonedragon/schedule/AthleteColorTest.kt`:

```kotlin
package com.stonedragon.schedule

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The widget must colour an athlete exactly as the web app does, or the two
 * disagree about who is who — which is worse than no colour at all.
 *
 * Expectations are the output of app.js's athleteColorIdx() over these keys.
 * DO NOT recompute them by reasoning about the hash; if this test fails, the
 * Kotlin port is wrong, not these numbers.
 */
class AthleteColorTest {
    private fun idx(key: String) = Theme.athleteColorIdx(key)

    @Test
    fun matchesTheWebApp() {
        assertEquals(7, idx("mrbndhp2z1bfz0"))
        assertEquals(7, idx("mrbndmh310pmc8"))
        assertEquals(0, idx("mr2gagizmq3itb"))
        assertEquals(7, idx("a1"))
        assertEquals(3, idx("Leo Frostholm"))
        assertEquals(3, idx("Alyssa Stielstra"))
        assertEquals(5, idx("0"))
    }

    /** djb2 seeded at 5381: an empty key is 5381 % 8. */
    @Test
    fun emptyKeyIsStable() {
        assertEquals(5, idx(""))
    }

    @Test
    fun everyIndexIsInThePalette() {
        listOf("a", "bb", "ccc", "", "mrbndhp2z1bfz0").forEach {
            val i = idx(it)
            assert(i in Theme.athletePalette.indices) { "index $i out of range for '$it'" }
        }
    }

    /** The id wins; the name is only a fallback for rows that have no id. */
    @Test
    fun idBeatsName() {
        assertEquals(Theme.athletePalette[idx("a1")], Theme.athleteColor("a1", "Leo Frostholm"))
        assertEquals(Theme.athletePalette[idx("Leo Frostholm")], Theme.athleteColor("", "Leo Frostholm"))
    }
}
```

- [ ] **Step 2: Port the hash and palette into `Theme.kt`**

Add to `internal object Theme`:

```kotlin
    /**
     * The web app's AVATAR_COLORS, in the same order — the index from
     * athleteColorIdx() is a position in THIS array, so the order is the
     * contract, not the values.
     */
    val athletePalette = intArrayOf(
        Color.parseColor("#06b6d4"), Color.parseColor("#10b981"),
        Color.parseColor("#8b5cf6"), Color.parseColor("#f59e0b"),
        Color.parseColor("#ef4444"), Color.parseColor("#ec4899"),
        Color.parseColor("#3b82f6"), Color.parseColor("#f97316"),
    )

    /**
     * djb2, ported from app.js athleteColorIdx().
     *
     * `h = ((h shl 5) + h + ch) or 0` in JS coerces to a SIGNED 32-BIT int on
     * every step. Kotlin's Int is already 32-bit and wraps the same way, so the
     * `| 0` has no Kotlin equivalent and needs none — but the value MUST stay
     * Int. Widen it to Long and the results diverge silently, which is exactly
     * the bug this is written to prevent.
     */
    fun athleteColorIdx(key: String): Int {
        var h = 5381
        for (ch in key) h = (h shl 5) + h + ch.code
        return kotlin.math.abs(h) % athletePalette.size
    }

    /** The id decides; the name is the fallback for rows that carry no id. */
    fun athleteColor(id: String, name: String): Int =
        athletePalette[athleteColorIdx(id.ifBlank { name })]
```

`Color.parseColor` is `android.graphics.Color`, already imported in this file.

- [ ] **Step 3: Fetch the athlete id**

In `Supabase.kt`, add `athleteId` to the data class:

```kotlin
data class Booking(
    val id: String,
    val startMillis: Long,
    val endMillis: Long,
    val athlete: String,
    // Blank for legacy setmore_events rows, which carry only a name. Those fall
    // back to the name hash and will NOT match the app's colour for that
    // athlete — accepted, because Setmore is switched off and these are history.
    val athleteId: String,
    val note: String,
)
```

Change the bookings select (line ~355) from:

```kotlin
            "?select=" + enc("id,start_at,end_at,note,status,athletes(display_name)") +
```

to:

```kotlin
            "?select=" + enc("id,start_at,end_at,note,status,athlete_id,athletes(display_name)") +
```

Then populate `athleteId` where `Booking(...)` is constructed from that response (read `athlete_id`, defaulting to `""`), and pass `athleteId = ""` at the `setmore_events` construction site.

- [ ] **Step 4: Push, confirm CI green**

```bash
git add android-widget/app
git commit -m "Port the app's per-athlete colour to the widget

Hashes the athlete id, exactly as app.js does, so the two never
disagree about who is which colour. Needs athlete_id on the query --
the widget knew athletes only by name."
git push origin main && gh run watch
```

Expected: `AthleteColorTest` passes. If `matchesTheWebApp` fails, the port is wrong — check `h` has not been widened to `Long`.

---

## Task 3: Saturation and transparency maths

Pure functions, testable, and the only place these are computed.

**Files:**
- Modify: `Theme.kt`, `Prefs.kt`
- Create: `app/src/test/java/com/stonedragon/schedule/ThemeTest.kt`

**Interfaces:**
- Consumes: Task 2's `Theme`
- Produces: `Theme.saturate(color: Int, amount: Float): Int`, `Theme.panelColor(light: Boolean, opacity: Float): Int`, `Theme.mutedColor(light: Boolean, opacity: Float): Int`. `Prefs.saturation(ctx): Float` and `Prefs.opacity(ctx): Float`, both 0f..1f defaulting to 1f.

- [ ] **Step 1: Write the failing test**

Create `app/src/test/java/com/stonedragon/schedule/ThemeTest.kt`:

```kotlin
package com.stonedragon.schedule

import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ThemeTest {
    private fun hsv(c: Int): FloatArray {
        val out = FloatArray(3); Color.colorToHSV(c, out); return out
    }

    @Test
    fun fullSaturationIsANoOp() {
        Theme.athletePalette.forEach { assertEquals(it, Theme.saturate(it, 1f)) }
    }

    @Test
    fun mutingNeverShiftsHue() {
        Theme.athletePalette.forEach { c ->
            val before = hsv(c)[0]
            listOf(0f, 0.25f, 0.5f, 0.75f).forEach { amt ->
                assertEquals(before, hsv(Theme.saturate(c, amt))[0], 0.01f)
            }
        }
    }

    @Test
    fun mutingIsMonotonicTowardGrey() {
        Theme.athletePalette.forEach { c ->
            val s = listOf(1f, 0.75f, 0.5f, 0.25f, 0f).map { hsv(Theme.saturate(c, it))[1] }
            s.zipWithNext { a, b -> assertTrue("saturation should fall: $s", b <= a + 0.001f) }
            assertEquals(0f, s.last(), 0.001f)
        }
    }

    @Test
    fun opacityLandsOnTheColourNotTheView() {
        assertEquals(255, Color.alpha(Theme.panelColor(false, 1f)))
        assertEquals(0, Color.alpha(Theme.panelColor(false, 0f)))
        // Monotonic in between.
        val a = listOf(0f, 0.25f, 0.5f, 0.75f, 1f).map { Color.alpha(Theme.panelColor(false, it)) }
        a.zipWithNext { x, y -> assertTrue("alpha should rise: $a", y >= x) }
    }

    /**
     * The panel gets more transparent; the writing must not get harder to read.
     * Muted text lifts toward the main text colour as the panel approaches glass.
     */
    @Test
    fun mutedTextLiftsAsThePanelClears() {
        val opaque = Theme.mutedColor(false, 1f)
        val glass = Theme.mutedColor(false, 0f)
        val text = Theme.textColor(false)
        fun dist(a: Int, b: Int) = Math.abs(Color.red(a) - Color.red(b)) +
            Math.abs(Color.green(a) - Color.green(b)) + Math.abs(Color.blue(a) - Color.blue(b))
        assertTrue("glass muted should sit nearer the text colour",
            dist(glass, text) < dist(opaque, text))
    }
}
```

**Note:** `android.graphics.Color` is stubbed to throw in plain unit tests unless
`testOptions { unitTests.isReturnDefaultValues = true }` is set — and defaults
would make these assertions meaningless. Add to `android { }` in
`app/build.gradle.kts`:

```kotlin
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
```

and add the Robolectric-free alternative: implement `saturate` and `panelColor`
with **pure integer maths** rather than `Color.colorToHSV`, so no Android class
is needed at runtime. Prefer this — it keeps the tests dependency-free:

```kotlin
    // HSV by hand, so this is testable on a bare JVM with no Android stubs and
    // no Robolectric. Hue is never touched; only S is scaled.
    fun saturate(color: Int, amount: Float): Int {
        val a = amount.coerceIn(0f, 1f)
        if (a >= 1f) return color
        val r = (color shr 16) and 0xFF
        val g = (color shr 8) and 0xFF
        val b = color and 0xFF
        // Rec. 601 luma: the grey a fully-desaturated colour collapses to.
        val grey = (0.299f * r + 0.587f * g + 0.114f * b)
        fun mix(c: Int) = (grey + (c - grey) * a).toInt().coerceIn(0, 255)
        return (color.toLong() and 0xFF000000L).toInt() or
            (mix(r) shl 16) or (mix(g) shl 8) or mix(b)
    }
```

With this form, the ThemeTest above must use its own channel helpers rather
than `Color.colorToHSV`. Rewrite `hsv()` in the test as a saturation proxy:
`max(r,g,b) - min(r,g,b)` (chroma), and assert chroma falls monotonically to 0
and that the ratios between channels are preserved. Hue-preservation becomes
"the ordering of r/g/b is unchanged".

- [ ] **Step 2: Add the two prefs**

In `Prefs.kt`, beside `K_ACCENT` / `K_LIGHT`:

```kotlin
    private const val K_SAT = "saturation"
    private const val K_OPACITY = "opacity"

    /** 0f = grey, 1f = full strength. Defaults to today's behaviour. */
    fun saturation(ctx: Context): Float = p(ctx).getFloat(K_SAT, 1f)
    fun setSaturation(ctx: Context, v: Float) = p(ctx).edit().putFloat(K_SAT, v).apply()

    /** 0f = glass, 1f = opaque. Defaults to today's behaviour. */
    fun opacity(ctx: Context): Float = p(ctx).getFloat(K_OPACITY, 1f)
    fun setOpacity(ctx: Context, v: Float) = p(ctx).edit().putFloat(K_OPACITY, v).apply()
```

- [ ] **Step 3: Apply saturation at the Theme choke points**

`accentFor`, `mutedColor` and `textColor` already exist as accessors. Add
saturation inside `accentFor` and the athlete colour path ONLY — text and muted
are near-neutral already and desaturating them does nothing but risk contrast.

- [ ] **Step 4: Push, confirm CI green**

```bash
git add android-widget/app
git commit -m "Widget saturation and transparency, as pure maths

Both are computed at Theme's choke points and tested on a bare JVM --
no Android stubs, no Robolectric -- because CI is the only place this
code can run at all."
git push origin main && gh run watch
```

---

## Task 4: The row edge, density, and row content

**Files:**
- Modify: `widget_row.xml`, `ScheduleWidgetService.kt`, `Prefs.kt`

**Interfaces:**
- Consumes: `Theme.athleteColor`, `Theme.saturate`, `Prefs`
- Produces: `Prefs.compact(ctx)`, `Prefs.showDuration(ctx)`, `Prefs.showNotes(ctx)` — all `Boolean`, defaulting to today's behaviour (`compact=false`, others `true`).

- [ ] **Step 1: Add the edge to the row layout**

In `widget_row.xml`, as the FIRST child of `row_root`, before the time column:

```xml
    <!-- The athlete's own colour. A plain View with a background colour, not a
         drawable and not a bitmap: setBackgroundColor is remotable, and a
         bitmap per row would blow the RemoteViews transaction budget. -->
    <View
        android:id="@+id/row_edge"
        android:layout_width="3dp"
        android:layout_height="match_parent"
        android:layout_marginEnd="8dp"
        android:background="#00000000" />
```

`row_root` needs `android:baselineAligned="false"` so the edge's `match_parent`
height does not disturb text alignment.

- [ ] **Step 2: Bind it, plus density and content**

In `ScheduleWidgetService.kt` where the row is bound (~line 191):

```kotlin
        val sat = Prefs.saturation(ctx)
        v.setInt(
            R.id.row_edge, "setBackgroundColor",
            Theme.saturate(Theme.athleteColor(b.athleteId, b.athlete), sat),
        )

        val compact = Prefs.compact(ctx)
        // Compact forces the duration off: it is the line compact exists to
        // remove, and leaving both switches live would let the coach pick a
        // "compact" that is the same height as comfortable.
        val showDur = Prefs.showDuration(ctx) && !compact
        v.setViewVisibility(R.id.row_dur, if (showDur && mins > 0) View.VISIBLE else View.GONE)
        val hasNote = Prefs.showNotes(ctx) && b.note.isNotBlank()
        v.setViewVisibility(R.id.row_meta, if (hasNote) View.VISIBLE else View.GONE)
```

The existing `hasNote` computation is replaced by the line above — do not leave
two.

- [ ] **Step 3: Add the three prefs**

```kotlin
    private const val K_COMPACT = "compact"
    private const val K_DUR = "show_duration"
    private const val K_NOTES = "show_notes"

    fun compact(ctx: Context): Boolean = p(ctx).getBoolean(K_COMPACT, false)
    fun setCompact(ctx: Context, on: Boolean) = p(ctx).edit().putBoolean(K_COMPACT, on).apply()
    fun showDuration(ctx: Context): Boolean = p(ctx).getBoolean(K_DUR, true)
    fun setShowDuration(ctx: Context, on: Boolean) = p(ctx).edit().putBoolean(K_DUR, on).apply()
    fun showNotes(ctx: Context): Boolean = p(ctx).getBoolean(K_NOTES, true)
    fun setShowNotes(ctx: Context, on: Boolean) = p(ctx).edit().putBoolean(K_NOTES, on).apply()
```

- [ ] **Step 4: Compact padding**

Compact tightens vertical padding. `setViewPadding` is remotable:

```kotlin
        val pad = if (compact) 2 else 6
        val px = (pad * ctx.resources.displayMetrics.density).toInt()
        v.setViewPadding(R.id.row_root, 0, px, 0, px)
```

- [ ] **Step 5: Push, confirm CI green, then install and look**

This is the first task with a visible result. After CI is green, install the
APK and check: the edge is visible against the wallpaper, and compact is
readable at arm's length. Those two cannot be settled any other way.

---

## Task 5: Span — how far ahead

**Files:**
- Modify: `Prefs.kt`, `ScheduleWidget.kt`
- Create: `app/src/test/java/com/stonedragon/schedule/SpanTest.kt`

**Interfaces:**
- Consumes: `Prefs`
- Produces: `Prefs.spanDays(ctx): Int` (3, 7 or 14; default 7), `Prefs.anchor(ctx, widgetId): Long`, `Prefs.setAnchor(...)`, and `ScheduleWidget.spanLabel(anchor, days, now): String`.

- [ ] **Step 1: Write the failing test**

Create `app/src/test/java/com/stonedragon/schedule/SpanTest.kt` asserting:
- the arrows step by the SPAN, not always a week (3 → +3 days, 14 → +14)
- the floor holds: stepping back from the current window never lands in the past
- `NOW` returns to the window containing today for each span
- the header label: `THIS WEEK · 3–9 AUG` for 7 anchored on today's week;
  `NEXT 3 DAYS · 7–9 AUG` for 3; a plain date range when the window does not
  contain today

Use fixed epoch millis, never `System.currentTimeMillis()`, so the test cannot
drift with the clock.

- [ ] **Step 2: Replace week with anchor + span**

`Prefs.week()` becomes `Prefs.anchor()`. Its existing rule — re-default whenever
the stored value is in the past — carries over to the anchor. `Supabase.startOfWeek`
stays for the 7-day case; 3 and 14 anchor on **today**, not a week boundary,
because "next 3 days" starting last Sunday would be a different and useless thing.

- [ ] **Step 3: Paging steps by span**

`ACTION_PREV` / `ACTION_NEXT` move by `Prefs.spanDays(ctx)` rather than 7.
`ACTION_TODAY` resets the anchor to the window containing now.

- [ ] **Step 4: Header label follows the span**

`ScheduleWidget.spanLabel` replaces the hardcoded `THIS WEEK` / `NEXT WEEK`
logic (~line 400). Keep the existing "THIS WEEK beats a date range when it
applies" instinct, generalised.

- [ ] **Step 5: Push, confirm CI green**

---

## Task 6: The premium surface

Last, because it is the only part that cannot be tested at all — and by now
everything under it is known good.

**Files:**
- Modify: `widget_schedule.xml`, `ScheduleWidget.kt`
- Create: `res/drawable/panel_gradient_dark.xml`, `panel_gradient_light.xml`

- [ ] **Step 1: The gradient panel**

Two drawables, alpha-based so they are accent-independent:

```xml
<!-- res/drawable/panel_gradient_dark.xml -->
<shape xmlns:android="http://schemas.android.com/apk/res/android">
    <corners android:radius="18dp" />
    <gradient
        android:type="linear"
        android:angle="270"
        android:startColor="#22FFFFFF"
        android:endColor="#00FFFFFF" />
</shape>
```

The light one uses `#18000000` → `#00000000`. Neither names an accent, so
adding a ninth accent later needs no new drawable.

- [ ] **Step 2: Transparency on the panel colour**

The panel's base colour gets the alpha (`Theme.panelColor(light, Prefs.opacity(ctx))`)
via `setInt(R.id.panel, "setBackgroundColor", …)`. The gradient drawable sits
in a separate overlay view ABOVE it, so the two do not multiply — the spec's
requirement.

- [ ] **Step 3: The gradient wordmark**

ONE bitmap per update. Render the header text with a `LinearGradient` between
the accent's two stops:

```kotlin
    private fun wordmark(text: String, from: Int, to: Int, density: Float): Bitmap {
        val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            textSize = 13f * density
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            letterSpacing = 0.06f
        }
        val w = Math.ceil(paint.measureText(text).toDouble()).toInt().coerceAtLeast(1)
        val fm = paint.fontMetrics
        val h = Math.ceil((fm.bottom - fm.top).toDouble()).toInt().coerceAtLeast(1)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        paint.shader = android.graphics.LinearGradient(
            0f, 0f, w.toFloat(), 0f, from, to, android.graphics.Shader.TileMode.CLAMP,
        )
        android.graphics.Canvas(bmp).drawText(text, 0f, -fm.top, paint)
        return bmp
    }
```

Set with `setImageViewBitmap`. **One call, in the header only.** If a second
bitmap is ever wanted, measure the transaction size first.

- [ ] **Step 4: Push, install, and look**

Nothing here is testable. Install and judge: does the wordmark read at widget
scale, does the gradient survive over a wallpaper, and where does the
transparency slider stop being usable.

---

## Task 7: The settings screen

**Files:**
- Modify: `activity_config.xml`, `ConfigActivity.kt`, `res/values/strings.xml`

- [ ] **Step 1: Add the controls**

Under the existing Appearance section: a 3-way span control (three
`RadioButton`s in a `RadioGroup`), a compact `Switch`, duration and notes
`Switch`es, and two `SeekBar`s for saturation and transparency.

- [ ] **Step 2: Wire them**

**Use `android.widget.CompoundButton` for every switch** — AppCompat inflates
`<Switch>` as `SwitchCompat`, which is not an `android.widget.Switch`, and
asking for the latter compiles and then throws at runtime. This has already bitten
once; the comment at `ConfigActivity.kt:98` explains it.

Each change writes its pref and triggers a widget update, the same way the
accent picker already does.

- [ ] **Step 3: Copy**

All new strings go in `strings.xml`. Say what the setting does, not what it is:
"How far ahead" over "Span"; the saturation slider's ends are "Muted" and
"Vivid"; transparency's are "Opaque" and "Glass".

- [ ] **Step 4: Push, install, confirm every control moves the widget**

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Athlete colour as a 3dp row edge | 4 |
| Ported hash matches the web app, tested | 2 |
| `athlete_id` added to the query | 2 |
| Setmore rows fall back to name, documented | 2 |
| Gradient wordmark, exactly one bitmap | 6 |
| Gradient surface, accent-independent | 6 |
| How far ahead (3/7/14), arrows step by span | 5 |
| Row density | 4 |
| Row content toggles (duration, notes) | 4 |
| Balance NOT offered | — (absent by design) |
| Transparency on colour not view | 3, 6 |
| Muted text lifts toward glass | 3 |
| Saturation on accent AND athlete colours | 3, 4 |
| Desktop-testable list all tested | 1, 2, 3, 5 |

**Placeholder scan:** Task 5's test bodies are described rather than written
out, because the exact epoch values depend on the anchor rules being settled in
Step 2 of that task — the assertions are enumerated precisely enough to write
them without further decisions. Everything else carries its code.

**Type consistency:** `Theme.athleteColorIdx(String): Int`,
`Theme.athleteColor(String, String): Int`, `Theme.saturate(Int, Float): Int`,
`Theme.panelColor(Boolean, Float): Int` are used identically across Tasks 2–6.
`Booking.athleteId: String` is set in both construction sites (Task 2, Step 3).
