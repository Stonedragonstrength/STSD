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

    // Friday 7 Aug 2026. Its week runs Mon 3 Aug – Sun 9 Aug.
    private val friday = at(2026, 8, 7)
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
    fun aWeekAnchorsToItsMonday() {
        assertEquals(Supabase.startOfDay(monday), Span.windowStart(friday, 7))
    }

    @Test
    fun shorterSpansAnchorToToday() {
        // "The next 3 days" starting last Monday would be a different and
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
        // Mon 3 Aug + 7 days => 3–9 AUG.
        assertEquals("3–9 AUG", Span.range(Supabase.startOfDay(monday), 7))
    }

    @Test
    fun aRangeAcrossTwoMonthsNamesBoth() {
        // Mon 27 Jul 2026 + 7 days => 27 JUL – 2 AUG.
        val jul27 = Supabase.startOfDay(at(2026, 7, 27))
        assertEquals("27 JUL – 2 AUG", Span.range(jul27, 7))
    }

    @Test
    fun threeDaysIsThreeDaysInclusive() {
        // Fri 7 + 3 days => 7–9, not 7–10.
        assertEquals("7–9 AUG", Span.range(Supabase.startOfDay(friday), 3))
    }
}
