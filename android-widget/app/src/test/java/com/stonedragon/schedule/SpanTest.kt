package com.stonedragon.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

/**
 * Date arithmetic is the part of this widget that fails invisibly. A window
 * showing Tuesday-to-Thursday when it should show Wednesday-to-Friday looks
 * entirely normal on a phone; only a test catches it.
 *
 * Every "now" here is a fixed instant, never System.currentTimeMillis(), so
 * these cannot start failing at a weekend.
 */
class SpanTest {

    /** Local midnight on a given date, so expectations read as dates. */
    private fun at(y: Int, m: Int, d: Int, h: Int = 12): Long {
        val c = Calendar.getInstance()
        c.set(y, m - 1, d, h, 0, 0)
        c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    // Friday 7 Aug 2026. Its week runs Sun 2 Aug – Sat 8 Aug.
    private val friday = at(2026, 8, 7)
    private val sunday = at(2026, 8, 2)
    private val monday = at(2026, 8, 3)

    @Test
    fun onlyTheOfferedSpansSurvive() {
        assertEquals(listOf(3, 7, 14), Span.ALLOWED)
        listOf(3, 7, 14).forEach { assertEquals(it, Span.normalise(it)) }
        // Anything stored by a future build, or corrupted, falls back to a week
        // rather than drawing an arbitrary number of days.
        listOf(0, 1, 5, 30, -7).forEach { assertEquals(7, Span.normalise(it)) }
    }

    @Test
    fun aWeekAnchorsToItsSunday() {
        assertEquals(Supabase.startOfDay(sunday), Span.windowStart(friday, 7))
    }

    @Test
    fun everyDayOfTheWeekAnchorsToTheSameSunday() {
        // Named dates prove one case; this proves the arithmetic. Every day of
        // that week — including Sunday itself, which must not fall back to the
        // PREVIOUS Sunday — has to land on 2 Aug, and the result has to be a
        // Sunday whatever the day.
        for (d in 2..8) {
            val start = Span.windowStart(at(2026, 8, d), 7)
            assertEquals("2026-08-$d", Supabase.startOfDay(sunday), start)
            val c = Calendar.getInstance()
            c.timeInMillis = start
            assertEquals("2026-08-$d", Calendar.SUNDAY, c.get(Calendar.DAY_OF_WEEK))
        }
    }

    @Test
    fun aStoredMondayReAnchorsToItsSunday() {
        // The upgrade path. Builds before Aug 2026 started the week on Monday,
        // and an installed widget keeps its prefs across an update, so
        // Prefs.windowStart re-anchors the stored value through here. A Monday
        // is LATER than the Sunday floor and would otherwise survive it and
        // draw a Monday-to-Sunday week for the rest of that week.
        assertEquals(Supabase.startOfDay(sunday), Span.windowStart(monday, 7))
        // And the same for a window the coach had paged forward to.
        val nextMonday = Supabase.addDays(Supabase.startOfDay(monday), 7)
        assertEquals(
            Supabase.addDays(Supabase.startOfDay(sunday), 7),
            Span.windowStart(nextMonday, 7),
        )
    }

    @Test
    fun shorterSpansAnchorToToday() {
        // "The next 3 days" starting last Sunday would be a different and
        // useless thing.
        assertEquals(Supabase.startOfDay(friday), Span.windowStart(friday, 3))
        assertEquals(Supabase.startOfDay(friday), Span.windowStart(friday, 14))
    }

    @Test
    fun arrowsStepByTheSpanNotAlwaysAWeek() {
        listOf(3, 7, 14).forEach { n ->
            val here = Span.windowStart(friday, n)
            val next = Span.step(here, n, forward = true, now = friday)
            assertEquals("span $n should move $n days", Supabase.addDays(here, n), next)
        }
    }

    @Test
    fun backFromTheCurrentWindowGoesNowhere() {
        // The floor. Last week is history the app shows better than a widget.
        listOf(3, 7, 14).forEach { n ->
            val here = Span.windowStart(friday, n)
            assertEquals(here, Span.step(here, n, forward = false, now = friday))
        }
    }

    @Test
    fun steppingForwardThenBackReturnsToTheStart() {
        listOf(3, 7, 14).forEach { n ->
            val here = Span.windowStart(friday, n)
            val out = Span.step(here, n, forward = true, now = friday)
            assertEquals(here, Span.step(out, n, forward = false, now = friday))
        }
    }

    @Test
    fun aWindowStrandedInThePastIsPulledForward() {
        // A widget left on a window over a weekend must come back showing the
        // one it is now, not keep rendering a window that has been and gone.
        val old = Supabase.addDays(Span.windowStart(friday, 7), -21)
        assertEquals(
            Span.windowStart(friday, 7),
            Span.step(old, 7, forward = false, now = friday),
        )
    }

    @Test
    fun theWordBeatsTheDatesWhenAWordApplies() {
        assertEquals("THIS WEEK", Span.label(Span.windowStart(friday, 7), 7, friday))
        assertEquals("NEXT 3 DAYS", Span.label(Span.windowStart(friday, 3), 3, friday))
        assertEquals("NEXT 14 DAYS", Span.label(Span.windowStart(friday, 14), 14, friday))
    }

    @Test
    fun nextWeekIsNamedToo() {
        val next = Supabase.addDays(Span.windowStart(friday, 7), 7)
        assertEquals("NEXT WEEK", Span.label(next, 7, friday))
    }

    @Test
    fun furtherOutFallsBackToDates() {
        val far = Supabase.addDays(Span.windowStart(friday, 7), 21)
        val label = Span.label(far, 7, friday)
        assertTrue("expected a date range, got '$label'", label.any { it.isDigit() })
        assertEquals(label, label.uppercase())
    }

    @Test
    fun aRangeInsideOneMonthNamesItOnce() {
        // Sun 2 Aug + 7 days => 2–8 AUG.
        assertEquals("2–8 AUG", Span.range(Supabase.startOfDay(sunday), 7))
    }

    @Test
    fun aRangeAcrossTwoMonthsNamesBoth() {
        // Sun 26 Jul 2026 + 7 days => 26 JUL – 1 AUG.
        val jul26 = Supabase.startOfDay(at(2026, 7, 26))
        assertEquals("26 JUL – 1 AUG", Span.range(jul26, 7))
    }

    @Test
    fun threeDaysIsThreeDaysInclusive() {
        // Fri 7 + 3 days => 7–9, not 7–10.
        assertEquals("7–9 AUG", Span.range(Supabase.startOfDay(friday), 3))
    }
}
