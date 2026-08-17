package com.stonedragon.schedule

import java.text.SimpleDateFormat
import java.util.Locale

/**
 * How far ahead the widget looks, and how paging behaves once that is a
 * setting rather than always a week.
 *
 * Pure functions over millis, in their own file, because this is arithmetic
 * about dates and off-by-one-day errors here are invisible on a screenshot —
 * a widget showing Tuesday-to-Thursday when it should show Wednesday-to-Friday
 * looks completely normal. It is exactly the kind of thing a JVM test can
 * settle and a phone cannot.
 *
 * No Android imports: java.util.Calendar (via Supabase's date helpers) and
 * SimpleDateFormat are both plain JDK, so all of this runs in a unit test.
 */
internal object Span {

    /** The spans offered. Anything else falls back to a week. */
    val ALLOWED = listOf(3, 7, 14)

    fun normalise(days: Int): Int = if (days in ALLOWED) days else 7

    /**
     * The start of the window containing [now].
     *
     * A week anchors to its SUNDAY, because "this week" is a thing with edges
     * that everybody agrees on. Three and fourteen days anchor to TODAY: "the
     * next 3 days" starting from last Sunday would be a different and useless
     * thing, and there is no calendar boundary that means "a fortnight".
     *
     * Also the re-anchor: pass a stored window start as [now] and it comes back
     * snapped onto the grid the current anchor and span actually use.
     */
    fun windowStart(now: Long, days: Int): Long =
        if (normalise(days) == 7) Supabase.startOfWeek(now) else Supabase.startOfDay(now)

    /**
     * Paging. The arrows step by the SPAN, not always by a week — on "next 3
     * days" they move three days, on a fortnight they move a fortnight.
     *
     * The current window is the floor, in both directions of travel: history is
     * something the app shows better than a widget can, and a coach paging back
     * through last month on a home screen is not a real journey.
     */
    fun step(start: Long, days: Int, forward: Boolean, now: Long): Long {
        val n = normalise(days)
        val floor = windowStart(now, n)
        val moved = Supabase.addDays(start, if (forward) n else -n)
        return if (moved < floor) floor else moved
    }

    /**
     * What the header says.
     *
     * The word beats the dates when a word applies — working out that a span of
     * dates means the week you are standing in is exactly the work a glanceable
     * widget should be saving. Either the word or the dates, never both: five
     * controls share that row, and "THIS WEEK · 3–9 AUG" ellipsised to "THIS…"
     * on a 250dp widget, which is less information rather than more.
     */
    fun label(start: Long, days: Int, now: Long): String {
        val n = normalise(days)
        val here = windowStart(now, n)
        if (start == here) {
            return when (n) {
                7 -> "THIS WEEK"
                else -> "NEXT $n DAYS"
            }
        }
        if (n == 7 && start == Supabase.addDays(here, 7)) return "NEXT WEEK"
        return range(start, n)
    }

    /** "4–10 AUG", or "28 JUL – 3 AUG" when the window straddles two months. */
    fun range(start: Long, days: Int): String {
        val end = Supabase.addDays(start, normalise(days) - 1)
        val sameMonth = fmt("MMM", start) == fmt("MMM", end)
        // Deliberately not `if (…) {…} else {…}.uppercase()` — a trailing call
        // after an if/else binds to the else branch alone, and the first half
        // would silently stay unshouted.
        val raw =
            if (sameMonth) fmt("d", start) + "–" + fmt("d MMM", end)
            else fmt("d MMM", start) + " – " + fmt("d MMM", end)
        return raw.uppercase(Locale.getDefault())
    }

    private fun fmt(pattern: String, millis: Long): String =
        SimpleDateFormat(pattern, Locale.getDefault()).format(java.util.Date(millis))
}
