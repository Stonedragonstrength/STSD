package com.stonedragon.schedule

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * Feeds the widget's list. Runs in the launcher's process, so it reads the day's
 * sessions back out of SharedPreferences rather than holding any state of its
 * own — the provider does the fetching, this only draws.
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

private class ScheduleFactory(
    private val ctx: Context,
    private val widgetId: Int,
) : RemoteViewsService.RemoteViewsFactory {

    private var rows: List<Booking> = emptyList()

    override fun onCreate() {}

    override fun onDataSetChanged() {
        // Same day the provider drew, or the list and the header disagree.
        val day = Prefs.day(ctx, widgetId)
        rows = if (Prefs.isLoaded(Prefs.state(ctx, widgetId))) {
            Prefs.bookings(ctx, widgetId, day)
        } else {
            emptyList()
        }
        // The launcher binds this service separately from the provider. If this
        // line never appears, the list is never asked for its contents and the
        // empty view is all the widget can possibly show.
        Prefs.note(ctx, "list id=$widgetId rows=" + rows.size)
    }

    override fun onDestroy() {
        rows = emptyList()
    }

    override fun getCount() = rows.size

    override fun getViewAt(position: Int): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_row)
        val b = rows.getOrNull(position) ?: return v

        v.setTextViewText(R.id.row_time, timeLabel(b.startMillis))
        v.setTextViewText(R.id.row_name, b.athlete.ifBlank { "Session" })

        // Length, and the note when there is one — a note is usually why this
        // session is different from the others, so it earns the line.
        val mins = TimeUnit.MILLISECONDS.toMinutes(b.endMillis - b.startMillis).toInt()
        val meta = buildString {
            if (mins > 0) append(mins).append("m")
            if (b.note.isNotBlank()) {
                if (isNotEmpty()) append(" · ")
                append(b.note)
            }
        }
        v.setTextViewText(R.id.row_meta, meta)

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

        v.setOnClickFillInIntent(
            R.id.row_root,
            Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.APP_URL)),
        )
        return v
    }

    override fun getLoadingView(): RemoteViews? = null
    override fun getViewTypeCount() = 1
    override fun getItemId(position: Int) = rows.getOrNull(position)?.id?.hashCode()?.toLong() ?: position.toLong()
    override fun hasStableIds() = true

    private fun timeLabel(millis: Long): String {
        val pattern = if (android.text.format.DateFormat.is24HourFormat(ctx)) "HH:mm" else "h:mma"
        return SimpleDateFormat(pattern, Locale.getDefault())
            .format(Date(millis))
            .replace("AM", "a")
            .replace("PM", "p")
    }
}
