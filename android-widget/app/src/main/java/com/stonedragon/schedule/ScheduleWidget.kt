package com.stonedragon.schedule

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The coach's day, on the home screen.
 *
 * One day at a time, with ‹ and › to step through it and the date itself as the
 * way back to today. A week grid was the other option and it loses on a phone:
 * at widget size a week is seven unreadable columns, and the question this is
 * meant to answer — "what does the rest of today look like" — is a day question.
 */
class ScheduleWidget : AppWidgetProvider() {

    companion object {
        const val ACTION_PREV = "com.stonedragon.schedule.PREV"
        const val ACTION_NEXT = "com.stonedragon.schedule.NEXT"
        const val ACTION_TODAY = "com.stonedragon.schedule.TODAY"
        const val ACTION_REFRESH = "com.stonedragon.schedule.REFRESH"
        const val EXTRA_WIDGET_ID = "widget_id"

        private val OUR_ACTIONS = setOf(ACTION_PREV, ACTION_NEXT, ACTION_TODAY, ACTION_REFRESH)

        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /** Redraws every widget — used after sign-in or sign-out. */
        fun refreshAll(ctx: Context) {
            val app = ctx.applicationContext
            val mgr = AppWidgetManager.getInstance(app)
            val ids = mgr.getAppWidgetIds(ComponentName(app, ScheduleWidget::class.java))
            for (id in ids) Prefs.saveState(app, id, "loading")
            scope.launch { for (id in ids) refresh(app, mgr, id) }
        }

        /** Paints from cache. Cheap, and safe to call on any thread. */
        fun paint(ctx: Context, mgr: AppWidgetManager, widgetId: Int) {
            val day = Prefs.day(ctx, widgetId)
            mgr.updateAppWidget(widgetId, buildViews(ctx, widgetId, day))
            mgr.notifyAppWidgetViewDataChanged(widgetId, R.id.widget_list)
        }

        /** Fetches the day, stores it, repaints. Blocking — call from IO. */
        fun refresh(ctx: Context, mgr: AppWidgetManager, widgetId: Int) {
            val day = Prefs.day(ctx, widgetId)
            when (val result = Supabase.bookingsForDay(ctx, day)) {
                is FetchResult.Ok -> {
                    Prefs.saveBookings(ctx, widgetId, result.bookings)
                    Prefs.saveState(ctx, widgetId, "ok")
                }
                is FetchResult.NotSignedIn -> Prefs.saveState(ctx, widgetId, "signin")
                is FetchResult.Failed -> Prefs.saveState(ctx, widgetId, "error:${result.message}")
            }
            paint(ctx, mgr, widgetId)
        }

        private fun buildViews(ctx: Context, widgetId: Int, day: Long): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget_schedule)
            val today = Supabase.startOfDay(System.currentTimeMillis())
            // Whether there is a session is knowable right here, with no network,
            // so it decides the state instead of waiting for a fetch to come back
            // and say so. Without this a widget placed before signing in reads
            // "Loading…" — and a sideloaded app that has never been launched sits
            // in Android's stopped state and receives no broadcasts, so nothing
            // ever arrives to correct it and the message is permanent.
            val state = if (!Supabase.isSignedIn(ctx)) "signin" else Prefs.state(ctx, widgetId)
            val bookings = if (state == "ok") Prefs.bookings(ctx, widgetId) else emptyList()

            // "Today" and "Tomorrow" beat a bare date when they apply — reading
            // a weekday and working out that it means today is exactly the work
            // a glanceable widget should be saving.
            val date = fmt("EEE d MMM", day).uppercase(Locale.getDefault())
            v.setTextViewText(
                R.id.widget_date,
                when (day) {
                    today -> "TODAY · $date"
                    Supabase.addDays(today, 1) -> "TOMORROW · $date"
                    else -> date
                }
            )
            v.setTextViewText(
                R.id.widget_count,
                when {
                    state == "signin" -> ""
                    state.startsWith("error") -> "—"
                    else -> bookings.size.toString()
                }
            )

            // setEmptyView only fires for an empty adapter, so every "nothing to
            // show" reason — no sessions, signed out, no signal — lands in the
            // same TextView and is told apart by its text.
            val svc = Intent(ctx, ScheduleWidgetService::class.java).apply {
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                // The launcher caches RemoteViewsService by Intent and ignores
                // extras when comparing. Without a unique data URI two widgets
                // share one factory and both show the same day.
                data = Uri.parse("sdwidget://$widgetId")
            }
            v.setRemoteAdapter(R.id.widget_list, svc)
            v.setEmptyView(R.id.widget_list, R.id.widget_empty)
            v.setTextViewText(
                R.id.widget_empty,
                when {
                    state == "signin" -> "Tap to sign in"
                    state.startsWith("error:") -> state.removePrefix("error:") + " · tap ⟳"
                    state == "loading" -> "Loading…"
                    day == today -> "Nothing booked today"
                    else -> "Nothing booked"
                }
            )

            v.setOnClickPendingIntent(R.id.widget_prev, actionIntent(ctx, ACTION_PREV, widgetId))
            v.setOnClickPendingIntent(R.id.widget_next, actionIntent(ctx, ACTION_NEXT, widgetId))
            v.setOnClickPendingIntent(R.id.widget_date, actionIntent(ctx, ACTION_TODAY, widgetId))
            v.setOnClickPendingIntent(R.id.widget_refresh, actionIntent(ctx, ACTION_REFRESH, widgetId))

            // The empty view is a button, and what it does is whatever the
            // message is asking for. "Loading…" and an error both retry — that
            // way a widget stuck on either is recoverable by tapping the thing
            // you would instinctively tap, instead of needing the small ⟳.
            v.setOnClickPendingIntent(
                R.id.widget_empty,
                when {
                    state == "signin" -> configIntent(ctx)
                    state == "loading" || state.startsWith("error:") ->
                        actionIntent(ctx, ACTION_REFRESH, widgetId)
                    else -> openAppIntent(ctx)
                },
            )
            v.setPendingIntentTemplate(R.id.widget_list, openAppTemplate(ctx))
            return v
        }

        private fun fmt(pattern: String, millis: Long): String =
            SimpleDateFormat(pattern, Locale.getDefault()).format(Date(millis))

        private fun actionIntent(ctx: Context, action: String, widgetId: Int): PendingIntent {
            val i = Intent(ctx, ScheduleWidget::class.java).apply {
                this.action = action
                putExtra(EXTRA_WIDGET_ID, widgetId)
                // Same reason as the service intent: extras alone don't make two
                // PendingIntents distinct, so the widget id goes in the URI.
                data = Uri.parse("sdwidget://$action/$widgetId")
            }
            return PendingIntent.getBroadcast(
                ctx, 0, i,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        private fun configIntent(ctx: Context): PendingIntent {
            val i = Intent(ctx, ConfigActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            return PendingIntent.getActivity(
                ctx, 1, i,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }

        private fun openAppIntent(ctx: Context): PendingIntent =
            PendingIntent.getActivity(
                ctx, 2, Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.APP_URL)),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        /**
         * Mutable by design: a template is completed with each row's own fill-in
         * Intent, which is exactly what FLAG_IMMUTABLE forbids.
         */
        private fun openAppTemplate(ctx: Context): PendingIntent =
            PendingIntent.getActivity(
                ctx, 3, Intent(Intent.ACTION_VIEW),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
    }

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        // goAsync inside onUpdate is still inside onReceive's call stack, which
        // is what keeps the process alive long enough for the fetch. Without it
        // the receiver returns, the process becomes killable, and the update
        // lands or doesn't depending on memory pressure.
        val pending = goAsync()
        val app = ctx.applicationContext
        for (id in ids) paint(app, mgr, id) // something on screen immediately
        scope.launch {
            try {
                for (id in ids) refresh(app, mgr, id)
            } finally {
                pending.finish()
            }
        }
    }

    override fun onDeleted(ctx: Context, ids: IntArray) {
        for (id in ids) Prefs.forgetWidget(ctx, id)
    }

    override fun onReceive(ctx: Context, intent: Intent) {
        val action = intent.action
        if (action !in OUR_ACTIONS) {
            super.onReceive(ctx, intent) // APPWIDGET_UPDATE/DELETED/ENABLED
            return
        }
        val widgetId = intent.getIntExtra(EXTRA_WIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return

        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        val today = Supabase.startOfDay(System.currentTimeMillis())
        val day = Prefs.day(app, widgetId)

        when (action) {
            // Today is the floor. Yesterday's sessions are history the app shows
            // better than a widget can, and a coach paging back through last
            // month on a home screen is not a real journey.
            ACTION_PREV -> Prefs.setDay(app, widgetId, maxOf(Supabase.addDays(day, -1), today))
            ACTION_NEXT -> Prefs.setDay(app, widgetId, Supabase.addDays(day, 1))
            ACTION_TODAY -> Prefs.setDay(app, widgetId, today)
        }
        if (action != ACTION_REFRESH) Prefs.saveState(app, widgetId, "loading")

        val pending = goAsync()
        paint(app, mgr, widgetId) // the date and arrows respond now
        scope.launch {
            try {
                refresh(app, mgr, widgetId)
            } finally {
                pending.finish()
            }
        }
    }
}
