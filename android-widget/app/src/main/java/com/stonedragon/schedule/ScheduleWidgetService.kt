package com.stonedragon.schedule

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Feeds the widget's list. Runs in the launcher's process, so it reads the
 * week's sessions back out of SharedPreferences rather than holding any state
 * of its own — the provider does the fetching, this only draws.
 */
class ScheduleWidgetService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory {
        val id = intent.getIntExtra(
            AppWidgetManager.EXTRA_APPWIDGET_ID,
            AppWidgetManager.INVALID_APPWIDGET_ID,
        )
        return ScheduleFactory(applicationContext, id)
    }
}

/**
 * One line of the week list: either a day divider or a session under it.
 *
 * The week is flattened into a single list because that is the only shape a
 * RemoteViews collection has — there is no nesting and no section API, so the
 * headers are rows like any other and the factory is what knows the difference.
 */
internal sealed class Row {
    data class Header(val dayStart: Long, val count: Int) : Row()
    data class Session(val booking: Booking) : Row()
}

/**
 * Monday to Sunday, every day present whether or not it has sessions — a rest
 * day is a real answer, and a week that silently omits it reads as a week that
 * failed to load half of itself.
 *
 * Returns EMPTY when the week holds nothing at all. setEmptyView only fires on
 * a zero-count adapter, so seven bare headers would suppress the message that
 * says whether the widget is empty or broken.
 *
 * Top-level and shared on purpose: the provider has to work out which index to
 * scroll to, and the factory has to lay out the same list. If those two
 * disagreed by one row the NOW button would land on the wrong day, so they are
 * not allowed to be two implementations.
 */
internal fun buildWeekRows(weekStart: Long, bookings: List<Booking>): List<Row> {
    if (bookings.isEmpty()) return emptyList()
    val out = ArrayList<Row>(bookings.size + 7)
    val sorted = bookings.sortedBy { it.startMillis }
    for (i in 0 until 7) {
        val from = Supabase.addDays(weekStart, i)
        val to = Supabase.addDays(weekStart, i + 1)
        val mine = sorted.filter { it.startMillis >= from && it.startMillis < to }
        out.add(Row.Header(from, mine.size))
        mine.forEach { out.add(Row.Session(it)) }
    }
    return out
}

/**
 * The row that should end up at the TOP of the screen: the next session that
 * has not finished, else today's header, else the top of the week.
 *
 * The next session rather than today's header, because by 4pm today's header
 * sits above six finished sessions and lands the coach exactly where they were
 * not looking.
 */
internal fun scrollIndexForNow(rows: List<Row>): Int {
    val now = System.currentTimeMillis()
    val next = rows.indexOfFirst { it is Row.Session && it.booking.endMillis >= now }
    if (next >= 0) return next
    val today = Supabase.startOfDay(now)
    val head = rows.indexOfFirst { it is Row.Header && it.dayStart == today }
    return if (head >= 0) head else 0
}

/**
 * Turns "I want row N at the top" into the row to hand setScrollPosition.
 *
 * RemoteViews.setScrollPosition is smoothScrollToPosition underneath, which
 * scrolls the MINIMUM distance to make a row visible — so asking for the target
 * directly parks it at the BOTTOM edge, under everything already on screen,
 * which is the least useful place for the session you are about to coach.
 * Asking for a row further down instead pushes the target up to the top.
 *
 * The lead is a guess at how many rows fit, because the launcher never tells
 * the widget its height in rows. Over-shooting is harmless — it clamps to the
 * end of the week and the target still lands high — so it is deliberately
 * generous rather than exact.
 */
internal fun scrollTargetForTop(rows: List<Row>, topIndex: Int): Int {
    val LEAD = 6
    return minOf(topIndex + LEAD, (rows.size - 1).coerceAtLeast(0))
}

private class ScheduleFactory(
    private val ctx: Context,
    private val widgetId: Int,
) : RemoteViewsService.RemoteViewsFactory {

    private var rows: List<Row> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        // Same week the provider drew, or the list and the header disagree.
        val week = Prefs.week(ctx, widgetId)
        val bookings = if (Prefs.isLoaded(Prefs.state(ctx, widgetId))) {
            Prefs.bookings(ctx, widgetId, week)
        } else {
            emptyList()
        }
        rows = buildWeekRows(week, bookings)
        // The launcher binds this service separately from the provider. If this
        // line never appears, the list is never asked for its contents and the
        // empty view is all the widget can possibly show.
        Prefs.note(ctx, "list id=$widgetId rows=" + rows.size + " sessions=" + bookings.size)
    }

    override fun onDestroy() {
        rows = emptyList()
    }

    override fun getCount() = rows.size

    override fun getViewAt(position: Int): RemoteViews {
        val row = rows.getOrNull(position)
        if (row is Row.Header) return headerView(row)
        val v = RemoteViews(ctx.packageName, R.layout.widget_row)
        val b = (row as? Row.Session)?.booking ?: return v

        // Same two prefs the provider reads. The factory runs in the launcher's
        // process and cannot be handed the palette, so it looks it up itself —
        // if these ever disagreed the header and the list would be two colours.
        val light = Prefs.lightBg(ctx)
        v.setTextColor(R.id.row_time, Theme.accentFor(Prefs.accentId(ctx), light))
        v.setTextColor(R.id.row_dur, Theme.mutedColor(light))
        v.setTextColor(R.id.row_name, Theme.textColor(light))
        v.setTextColor(R.id.row_meta, Theme.mutedColor(light))

        v.setTextViewText(R.id.row_time, timeLabel(b.startMillis))
        v.setTextViewText(R.id.row_name, b.athlete.ifBlank { "Session" })

        // Duration rides under the time, in the column that already had the
        // height to spare.
        val mins = TimeUnit.MILLISECONDS.toMinutes(b.endMillis - b.startMillis).toInt()
        v.setTextViewText(R.id.row_dur, if (mins > 0) mins.toString() + "m" else "")

        // The second line is the note or nothing. GONE rather than empty text:
        // an empty TextView still claims its line height, which is the whole
        // thing this was meant to stop spending.
        val hasNote = b.note.isNotBlank()
        v.setTextViewText(R.id.row_meta, b.note)
        v.setViewVisibility(R.id.row_meta, if (hasNote) View.VISIBLE else View.GONE)

        // A finished session is dimmed rather than hidden: the coach still wants
        // the shape of the whole day, and a list that empties itself as the day
        // goes on reads like data going missing.
        // setFloat, not setInt — View.setAlpha takes a float, and setInt would
        // look for a setAlpha(int) that only Drawable has.
        v.setFloat(
            R.id.row_root,
            "setAlpha",
            if (b.endMillis < System.currentTimeMillis()) 0.42f else 1f,
        )

        // Only an extra. fillIn() will not overwrite an action or data the
        // template already set, so putting them here would silently do nothing —
        // extras are the part that reliably merges.
        v.setOnClickFillInIntent(
            R.id.row_root,
            Intent().putExtra(ScheduleWidget.EXTRA_URL, BuildConfig.APP_URL),
        )
        return v
    }

    /**
     * A day divider. Today is called out by name and drawn at full strength;
     * days already gone are dimmed like a finished session, so scrolling back
     * up the week reads as history rather than as a schedule.
     */
    private fun headerView(h: Row.Header): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_day_header)
        val today = Supabase.startOfDay(System.currentTimeMillis())
        val light = Prefs.lightBg(ctx)
        // Today's divider takes the accent; the rest stay quiet, so the eye
        // finds the current day without reading a single word.
        v.setTextColor(
            R.id.hdr_day,
            if (h.dayStart == today) Theme.accentFor(Prefs.accentId(ctx), light)
            else Theme.mutedColor(light),
        )
        v.setTextColor(R.id.hdr_count, Theme.mutedColor(light))
        val label = SimpleDateFormat("EEE d MMM", Locale.getDefault())
            .format(Date(h.dayStart))
            .uppercase(Locale.getDefault())
        v.setTextViewText(
            R.id.hdr_day,
            when (h.dayStart) {
                today -> "$label · TODAY"
                Supabase.addDays(today, 1) -> "$label · TOMORROW"
                else -> label
            },
        )
        // "—" rather than "0": a dash reads as nothing booked, where a zero in a
        // column of counts reads like a number that failed to arrive.
        v.setTextViewText(R.id.hdr_count, if (h.count == 0) "—" else h.count.toString())
        v.setFloat(R.id.hdr_root, "setAlpha", if (h.dayStart < today) 0.42f else 1f)
        return v
    }

    override fun getLoadingView(): RemoteViews? = null

    // Two layouts: the day divider and the session row. Getting this wrong
    // recycles one into the other and the list draws headers as sessions.
    override fun getViewTypeCount() = 2

    override fun getItemId(position: Int): Long = when (val r = rows.getOrNull(position)) {
        is Row.Header -> r.dayStart          // unique per day, stable across refreshes
        is Row.Session -> r.booking.id.hashCode().toLong()
        null -> position.toLong()
    }

    override fun hasStableIds() = true

    private fun timeLabel(millis: Long): String {
        val pattern = if (android.text.format.DateFormat.is24HourFormat(ctx)) "HH:mm" else "h:mma"
        return SimpleDateFormat(pattern, Locale.getDefault())
            .format(Date(millis))
            .replace("AM", "a")
            .replace("PM", "p")
    }
}
