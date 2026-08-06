package com.stonedragon.schedule

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Where NOW wants the list: [top] is the row that should end up against the top
 * edge — the next unfinished session — and [target] is the row below it that
 * has to be asked for to get it there. See ScheduleWidget.settleThenScroll.
 *
 * Top-level, like Row next door, rather than tucked inside the companion: the
 * provider's own onUpdate and onReceive hold one of these, and a type private
 * to the companion is a visibility argument nothing on this machine can settle
 * — there is no compiler here, only CI.
 */
internal class Jump(val target: Int, val top: Int)

/**
 * A painted frame, plus the jump it wants applied once the list has caught up
 * with it — the two cannot travel together, see ScheduleWidget.settleThenScroll.
 */
internal class Frame(val views: RemoteViews, val scrollTo: Jump?)

/**
 * The coach's week, on the home screen.
 *
 * One scrolling list, Monday to Sunday, day headers interleaved with sessions,
 * with ‹ and › to step whole weeks and NOW to come back to the next session.
 * A week GRID was the other option and it loses on a phone: at widget size a
 * week is seven unreadable columns, and RemoteViews has no horizontal scroller
 * to rescue it. It started as a day at a time, which answered "what is left of
 * today" and nothing about tomorrow.
 */
class ScheduleWidget : AppWidgetProvider() {

    companion object {
        const val ACTION_PREV = "com.stonedragon.schedule.PREV"
        const val ACTION_NEXT = "com.stonedragon.schedule.NEXT"
        // Named TODAY since the day-at-a-time build; it means "this week, and
        // scrolled to the next session" now.
        const val ACTION_TODAY = "com.stonedragon.schedule.TODAY"
        const val ACTION_REFRESH = "com.stonedragon.schedule.REFRESH"
        // Row taps land here rather than going straight to the browser, so the
        // template PendingIntent can name an explicit component. See
        // openAppTemplate for why that is not optional.
        const val ACTION_OPEN = "com.stonedragon.schedule.OPEN"
        const val EXTRA_WIDGET_ID = "widget_id"
        const val EXTRA_URL = "url"

        // A List, not a Set: the position doubles as the PendingIntent request
        // code, so each button gets its own. `in` still reads as membership.
        private val OUR_ACTIONS = listOf(ACTION_PREV, ACTION_NEXT, ACTION_TODAY, ACTION_REFRESH)

        // How long to give the launcher to rebind the list and pick up the rows
        // a paint just published — long enough that the rows are really there,
        // short enough that NOW still feels like a button press rather than a
        // page load — and then how long to let the first scroll finish before
        // the second one asks from a list that has stopped moving. Both are
        // waits on something with no callback to wait for; see settleThenScroll.
        private const val SCROLL_SETTLE_MS = 450L
        private const val SCROLL_CONFIRM_MS = 600L

        // SupervisorJob alone does NOT stop an exception here from reaching the
        // thread's default handler and killing the app — it only stops siblings
        // cancelling each other. Without this handler any unexpected throw in a
        // background refresh crashed the whole app, which is what made Sign out
        // impossible: it fired a refresh, the refresh threw, the app died before
        // the screen could redraw.
        private val scope = CoroutineScope(
            SupervisorJob() + Dispatchers.IO +
                CoroutineExceptionHandler { _, e -> CrashLog.record(null, e, "widget/background") }
        )

        /**
         * What every placed widget currently believes, for the diagnostic on the
         * config screen. A widget can only show one line of text, which is not
         * enough to tell "no sessions today" from "the token was rejected" from
         * "this frame is stale" — and guessing between those from a description
         * over the phone is how a bug takes three installs to find.
         */
        fun debugSummary(ctx: Context): String {
            val app = ctx.applicationContext
            val mgr = AppWidgetManager.getInstance(app)
            val ids = mgr.getAppWidgetIds(ComponentName(app, ScheduleWidget::class.java))
            if (ids.isEmpty()) return "No widget placed on the home screen."
            return ids.joinToString("\n") { id ->
                val week = Prefs.week(app, id)
                val n = Prefs.bookings(app, id, week).size
                "Widget $id: state=${Prefs.state(app, id)}, cached=$n, " +
                    "week of " + fmt("EEE d MMM", week)
            }
        }

        private fun widgetIds(app: Context): IntArray =
            AppWidgetManager.getInstance(app)
                .getAppWidgetIds(ComponentName(app, ScheduleWidget::class.java))

        /** Fetches every widget again. Used after a successful sign-in. */
        fun refreshAll(ctx: Context) {
            val app = ctx.applicationContext
            val mgr = AppWidgetManager.getInstance(app)
            val ids = widgetIds(app)
            for (id in ids) Prefs.saveState(app, id, "loading")
            scope.launch { for (id in ids) refresh(app, mgr, id) }
        }

        /** Same, but waits. Call from IO — used by the diagnostic. */
        fun refreshBlocking(ctx: Context) {
            val app = ctx.applicationContext
            val mgr = AppWidgetManager.getInstance(app)
            for (id in widgetIds(app)) refresh(app, mgr, id)
        }

        /**
         * Redraws from storage without fetching. The launcher keeps whatever
         * RemoteViews it was last handed, so a frame painted while signed out
         * survives a later sign-in until something explicitly repaints — which
         * is how a widget can sit on "Tap to sign in" while the app knows
         * perfectly well that it is signed in.
         */
        fun repaintAll(ctx: Context) {
            val app = ctx.applicationContext
            val mgr = AppWidgetManager.getInstance(app)
            // A repaint can inherit a jump that a killed process never got to
            // apply, so it honours one if it finds it rather than swallowing it.
            for (id in widgetIds(app)) paint(app, mgr, id)?.let { scrollLater(app, mgr, id, it) }
        }

        /**
         * Signed out: forget the cached day and redraw, with no network at all.
         * Sign-out used to go through refreshAll, which fetched a schedule it
         * could no longer be entitled to — pointless, and the throw that took
         * the app down with it. It also left the last day's sessions cached, so
         * a signed-out widget could still be showing athlete names.
         */
        fun signedOutAll(ctx: Context) {
            val app = ctx.applicationContext
            val mgr = AppWidgetManager.getInstance(app)
            for (id in widgetIds(app)) {
                Prefs.saveBookings(app, id, Prefs.week(app, id), emptyList())
                Prefs.saveState(app, id, "signin")
                paint(app, mgr, id)
            }
        }

        /**
         * Paints from cache. Cheap, safe on any thread, and never throws — a
         * widget that cannot draw itself has no way to report that it could not,
         * so the failure is recorded and swallowed rather than propagated.
         *
         * Returns the jump NOW wants, or null in the ordinary case of a frame
         * that should leave the list exactly where the coach left it. The
         * scroll is deliberately NOT applied here — see settleThenScroll for
         * why it cannot ride along with the paint. Callers that are already on
         * IO should pass it to settleThenScroll; the rest, to scrollLater.
         */
        private fun paint(ctx: Context, mgr: AppWidgetManager, widgetId: Int): Jump? {
            return try {
                val week = Prefs.week(ctx, widgetId)
                val signedIn = Supabase.isSignedIn(ctx)
                val frame = buildFrame(ctx, mgr, widgetId, week)
                mgr.updateAppWidget(widgetId, frame.views)
                mgr.notifyAppWidgetViewDataChanged(widgetId, R.id.widget_list)
                // Noted AFTER the launcher call returns, so a line here means the
                // frame was accepted without complaint. If the screen still
                // disagrees with what this says, the problem is past our code.
                Prefs.note(
                    ctx,
                    "paint id=$widgetId signedIn=$signedIn state=" + Prefs.state(ctx, widgetId),
                )
                frame.scrollTo
            } catch (t: Throwable) {
                Prefs.note(
                    ctx,
                    "paint id=$widgetId THREW " + t.javaClass.simpleName +
                        ": " + (t.message ?: "").take(140),
                )
                CrashLog.record(ctx, t, "paint")
                null
            }
        }

        /**
         * Waits for the list to catch up with the frame, then scrolls it.
         * Blocking — call from IO.
         *
         * The wait is the whole point. notifyAppWidgetViewDataChanged is
         * asynchronous: it asks the launcher to rebind the factory, and the
         * rows arrive some tens or hundreds of milliseconds later, with no
         * callback to say when. A setScrollPosition inside the same RemoteViews
         * therefore runs against whatever the list held BEFORE the paint —
         * either the previous week's rows, which is the visible stutter of a
         * scroll starting and then being yanked back as the data lands, or an
         * empty list, where smoothScrollToPosition does nothing at all and NOW
         * appears to move the week and then just sit there.
         *
         * Then it scrolls TWICE, and the pair is not a retry: which edge a row
         * lands on depends on which way the list travelled to reach it. Going
         * down it stops as soon as the row is visible, at the BOTTOM edge, so
         * getting the next session to the top means aiming at the last row that
         * fits below it. Going up it stops with the row at the TOP edge, and
         * that same aim leaves the session a screenful above the viewport,
         * off screen — which is what pressing NOW after scrolling ahead to
         * Friday used to do.
         *
         * So: aim past it, then ask for the session itself.
         *  - Coming from above, the first lands it at the top and the second is
         *    a no-op — smoothScrollToPosition to a row that is already fully
         *    visible computes a zero delta and does not move. One motion.
         *  - Coming from below, the first overshoots and the second brings it
         *    back to the top edge.
         *  - Already on screen, both are small or nothing.
         * Ending on the session rather than on the overshoot is also what makes
         * an early first scroll survivable: whatever it did to a list that had
         * not loaded yet, the last word is always "show the next session".
         */
        private fun settleThenScroll(
            ctx: Context,
            mgr: AppWidgetManager,
            widgetId: Int,
            jump: Jump,
        ) {
            try {
                Thread.sleep(SCROLL_SETTLE_MS)
                applyScroll(ctx, mgr, widgetId, jump.target)
                // Long enough that the first scroll has finished. Cut this short
                // and the second one recomputes from a moving list, which is
                // how a scroll turns into a bounce.
                Thread.sleep(SCROLL_CONFIRM_MS)
                applyScroll(ctx, mgr, widgetId, jump.top)
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }

        /**
         * A partial update carrying nothing but the scroll. partiallyUpdateAppWidget
         * applies these actions over the frame already on screen; a full
         * updateAppWidget would re-run every action — colours, text, the remote
         * adapter — and reset the list underneath the animation it just started.
         */
        private fun applyScroll(
            ctx: Context,
            mgr: AppWidgetManager,
            widgetId: Int,
            position: Int,
        ) {
            try {
                val v = RemoteViews(ctx.packageName, R.layout.widget_schedule)
                v.setScrollPosition(R.id.widget_list, position)
                mgr.partiallyUpdateAppWidget(widgetId, v)
                Prefs.note(ctx, "scroll id=$widgetId to=$position")
            } catch (t: Throwable) {
                CrashLog.record(ctx, t, "scroll")
            }
        }

        /** Same, off the caller's thread — for the paints that are not in a fetch. */
        private fun scrollLater(ctx: Context, mgr: AppWidgetManager, widgetId: Int, jump: Jump) {
            scope.launch { settleThenScroll(ctx, mgr, widgetId, jump) }
        }

        /**
         * Fetches the day, stores it, repaints. Blocking — call from IO.
         *
         * The paint is in a finally: a throw in the fetch used to skip it, which
         * left whatever frame was already on the home screen. That is how a
         * successful sign-in still showed "Tap to sign in" — the state was
         * right in storage and the widget was never told.
         */
        fun refresh(ctx: Context, mgr: AppWidgetManager, widgetId: Int) {
            val week = Prefs.week(ctx, widgetId)
            Prefs.note(ctx, "refresh id=$widgetId start")
            try {
                when (val result = Supabase.bookingsForWeek(ctx, week)) {
                    is FetchResult.Ok -> {
                        Prefs.saveBookings(ctx, widgetId, week, result.bookings)
                        Prefs.saveState(ctx, widgetId, if (result.partial) "partial" else "ok")
                    }
                    is FetchResult.NotSignedIn -> Prefs.saveState(ctx, widgetId, "signin")
                    is FetchResult.Failed -> Prefs.saveState(ctx, widgetId, "error:${result.message}")
                }
            } catch (t: Throwable) {
                // Throwable, not Exception: an Error here (a missing class on an
                // odd OEM ROM, say) would otherwise sail past and kill the app.
                CrashLog.record(ctx, t, "refresh")
                Prefs.saveState(ctx, widgetId, "error:" + (t.message ?: t.javaClass.simpleName))
            } finally {
                // The scroll rides on this thread rather than a posted one: the
                // callers hold a goAsync() pending result open until this
                // returns, and that is what keeps the process alive long enough
                // to send it.
                paint(ctx, mgr, widgetId)?.let { settleThenScroll(ctx, mgr, widgetId, it) }
            }
        }

        private fun buildFrame(
            ctx: Context,
            mgr: AppWidgetManager,
            widgetId: Int,
            week: Long,
        ): Frame {
            val v = RemoteViews(ctx.packageName, R.layout.widget_schedule)
            val thisWeek = Supabase.startOfWeek(System.currentTimeMillis())
            // Whether there is a session is knowable right here, with no network,
            // so it decides the state instead of waiting for a fetch to come back
            // and say so. Without this a widget placed before signing in reads
            // "Loading…" — and a sideloaded app that has never been launched sits
            // in Android's stopped state and receives no broadcasts, so nothing
            // ever arrives to correct it and the message is permanent.
            val state = if (!Supabase.isSignedIn(ctx)) "signin" else Prefs.state(ctx, widgetId)
            // Week-stamped, so this is empty unless the cache holds THIS week.
            val bookings = if (Prefs.isLoaded(state)) Prefs.bookings(ctx, widgetId, week) else emptyList()
            // A failed refresh over a cache that still has the week is stale, not
            // broken. The sessions are shown and the header carries the warning,
            // rather than the widget going blank over perfectly good data.
            val stale = bookings.isNotEmpty() && (state.startsWith("error:") || state == "loading")

            // "This week" beats a date range when it applies — working out that a
            // span of dates means the week you are standing in is exactly the
            // work a glanceable widget should be saving.
            val sunday = Supabase.addDays(week, 6)
            // "4–10 AUG", or "28 JUL – 3 AUG" when the week straddles two months.
            val sameMonth = fmt("MMM", week) == fmt("MMM", sunday)
            // Deliberately not `if (…) {…} else {…}.uppercase()` — a trailing
            // call after an if/else block binds to the else branch, not to the
            // whole expression, and the first half would silently stay unshouted.
            val spanRaw =
                if (sameMonth) fmt("d", week) + "–" + fmt("d MMM", sunday)
                else fmt("d MMM", week) + " – " + fmt("d MMM", sunday)
            val span = spanRaw.uppercase(Locale.getDefault())
            // Either the word or the dates, never both. Five controls now share
            // this row with it, and "THIS WEEK · 3–9 AUG" ellipsized to "THIS…"
            // on a 250dp widget — which is less information, not more.
            v.setTextViewText(
                R.id.widget_date,
                when (week) {
                    thisWeek -> "THIS WEEK"
                    Supabase.addDays(thisWeek, 7) -> "NEXT WEEK"
                    else -> span
                }
            )
            // Status only — no session count. "How many this week" is not a
            // number you act on, and the pill was taking width from a row that
            // already carries five controls. What survives is the part that
            // changes a decision: whether what you are reading can be trusted.
            // Empty in the normal case, and then the pill is GONE rather than a
            // background chip floating in the row — which is where the extra
            // breathing room comes from.
            val status = when {
                state == "signin" -> ""
                // Cached sessions from a refresh that failed: real, possibly out
                // of date, and it says so.
                stale -> "⚠"
                state.startsWith("error") -> "—"
                // One source answered and one didn't, so the list is a floor
                // rather than the whole week.
                state == "partial" -> "+"
                else -> ""
            }
            v.setTextViewText(R.id.widget_count, status)
            v.setViewVisibility(R.id.widget_count, if (status.isEmpty()) View.GONE else View.VISIBLE)

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
                    // Naming the week it actually checked is what separates "you
                    // have no sessions" from "this thing is broken" — which is
                    // the difference an empty widget cannot otherwise show.
                    week == thisWeek -> "No sessions booked this week"
                    else -> "No sessions week of " + fmt("EEE d MMM", week)
                }
            )

            // Colours are applied here rather than baked into the layout, since
            // the layout is compiled once and the coach can repaint any time.
            // The list rows are coloured by the factory, which reads the same
            // two prefs — see ScheduleWidgetService.
            val light = Prefs.lightBg(ctx)
            val accent = Theme.accentFor(Prefs.accentId(ctx), light)
            val fg = Theme.textColor(light)
            val dim = Theme.mutedColor(light)
            v.setInt(R.id.widget_root, "setBackgroundResource", Theme.bgRes(light))
            v.setTextColor(R.id.widget_date, fg)
            v.setTextColor(R.id.widget_count, accent)
            v.setTextColor(R.id.widget_prev, accent)
            v.setTextColor(R.id.widget_next, accent)
            v.setTextColor(R.id.widget_now, accent)
            v.setTextColor(R.id.widget_refresh, dim)
            v.setTextColor(R.id.widget_settings, dim)
            v.setTextColor(R.id.widget_empty, dim)

            v.setOnClickPendingIntent(R.id.widget_prev, actionIntent(ctx, ACTION_PREV, widgetId))
            v.setOnClickPendingIntent(R.id.widget_next, actionIntent(ctx, ACTION_NEXT, widgetId))
            v.setOnClickPendingIntent(R.id.widget_date, actionIntent(ctx, ACTION_TODAY, widgetId))
            v.setOnClickPendingIntent(R.id.widget_now, actionIntent(ctx, ACTION_TODAY, widgetId))
            v.setOnClickPendingIntent(R.id.widget_refresh, actionIntent(ctx, ACTION_REFRESH, widgetId))
            // Straight to the activity — no broadcast round trip, and no
            // android:configure, which the launcher would treat as a widget it
            // is allowed to drop if the activity ever failed to return RESULT_OK.
            v.setOnClickPendingIntent(R.id.widget_settings, configIntent(ctx))

            // Jump to now, but only when it was actually asked for — see
            // Prefs.requestJump. Consumed here so the next routine repaint
            // leaves the coach where they scrolled to.
            //
            // "loading" is excluded, and that exclusion is the fix for the
            // stutter. Pressing NOW paints twice: once immediately so the
            // header answers the tap, then again when the fetch lands. The
            // first paint has cached rows whenever the coach was already on
            // this week, so it used to claim the jump and start a scroll that
            // the second paint's data reload then yanked out from under it.
            // Nothing before a settled frame gets to scroll.
            //
            // The rows are still tested BEFORE the flag is taken. A jump from
            // another week reaches a settled frame with the cache still stamped
            // to the OLD week; taking the flag there would burn the request on
            // a frame with nothing to scroll to.
            var scrollTo: Jump? = null
            if (state != "loading") {
                if (bookings.isNotEmpty()) {
                    if (Prefs.takeJump(ctx, widgetId)) {
                        val weekRows = buildWeekRows(week, bookings)
                        val top = scrollIndexForNow(weekRows)
                        // Both rows, not just the one — see settleThenScroll.
                        // Asking for `top` alone parks it at the bottom edge.
                        scrollTo = Jump(
                            scrollTargetForTop(
                                weekRows,
                                top,
                                listHeightDp(mgr, widgetId),
                                ctx.resources.configuration.fontScale,
                            ),
                            top,
                        )
                    }
                } else if (state == "ok" || state == "partial" || state == "signin") {
                    // A finished fetch that genuinely found nothing, or a widget
                    // that is signed out and holds nothing to find. Drop the
                    // request rather than leave it armed to fire on some
                    // unrelated repaint days later.
                    Prefs.takeJump(ctx, widgetId)
                }
            }

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
            return Frame(v, scrollTo)
        }

        /**
         * The list's own height in dp — the widget minus the chrome above it.
         *
         * The launcher reports the widget's size in the options bundle, where
         * for height MIN is the landscape bound and MAX the portrait one. The
         * home screen is portrait, so MAX is the honest number. A launcher that
         * reports neither leaves zeroes, hence the declared minHeight as a floor
         * — under-stating the height only costs a row of scroll accuracy.
         */
        private fun listHeightDp(mgr: AppWidgetManager, widgetId: Int): Int {
            val reported = try {
                mgr.getAppWidgetOptions(widgetId)
                    .getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)
            } catch (t: Throwable) {
                0
            }
            // 180dp is the minHeight in widget_info.xml: the smallest this can
            // legitimately be, and so the safest thing to assume.
            val widget = if (reported > 0) reported else 180
            // 6dp of root padding top and bottom, a 32dp control row, and the
            // 2dp under it — all of it spent before the list sees a pixel.
            return (widget - 46).coerceAtLeast(40)
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
            // A distinct request code per action per widget as well as a distinct
            // URI. The URI alone should be enough — PendingIntent equality ignores
            // extras but not data — and relying on "should be" is how a Refresh
            // button ends up wired to whatever was registered before it.
            val code = widgetId * 8 + (OUR_ACTIONS.indexOf(action) + 1)
            return PendingIntent.getBroadcast(
                ctx, code, i,
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
         * The row-tap template. Mutable by necessity — a template is completed
         * with each row's fill-in Intent, which is exactly what FLAG_IMMUTABLE
         * forbids — so the Intent inside it MUST be explicit.
         *
         * This was `Intent(ACTION_VIEW)` with no component: implicit. From
         * Android 14, a mutable PendingIntent around an implicit Intent throws
         * IllegalArgumentException, and because this is built inside
         * buildFrame() it took the entire paint down with it. Every paint, on
         * every widget, since the first build — the widget could never draw
         * anything, which is why it showed the static initialLayout forever
         * while storage said everything was fine.
         *
         * It targets this receiver rather than a browser Intent, so the
         * component is explicit; ACTION_OPEN then starts the browser from
         * outside the PendingIntent, where an implicit Intent is fine.
         */
        private fun openAppTemplate(ctx: Context): PendingIntent =
            PendingIntent.getBroadcast(
                ctx, 7,
                Intent(ctx, ScheduleWidget::class.java).setAction(ACTION_OPEN),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
    }

    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        Prefs.note(ctx, "onUpdate ids=" + ids.joinToString(","))
        // goAsync inside onUpdate is still inside onReceive's call stack, which
        // is what keeps the process alive long enough for the fetch. Without it
        // the receiver returns, the process becomes killable, and the update
        // lands or doesn't depending on memory pressure.
        val pending = goAsync()
        val app = ctx.applicationContext
        // Something on screen immediately. It rarely has a jump to honour — one
        // is normally armed and spent inside a single NOW press — but a process
        // killed between the two would leave one waiting here.
        for (id in ids) paint(app, mgr, id)?.let { scrollLater(app, mgr, id, it) }
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
        // Every broadcast that reaches this receiver, including the framework's
        // own. If nothing appears here when a widget is placed or ⟳ is tapped,
        // the receiver is not being reached at all and no amount of repainting
        // was ever going to help.
        Prefs.note(ctx, "onReceive " + (action ?: "null").substringAfterLast('.'))

        // A row tap. The browser Intent is built HERE, outside any PendingIntent,
        // where being implicit is perfectly legal.
        if (action == ACTION_OPEN) {
            val url = intent.getStringExtra(EXTRA_URL) ?: BuildConfig.APP_URL
            try {
                ctx.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            } catch (e: Exception) {
                CrashLog.record(ctx, e, "openApp")
            }
            return
        }

        if (action !in OUR_ACTIONS) {
            super.onReceive(ctx, intent) // APPWIDGET_UPDATE/DELETED/ENABLED
            return
        }
        val widgetId = intent.getIntExtra(EXTRA_WIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return

        val app = ctx.applicationContext
        val mgr = AppWidgetManager.getInstance(app)
        val thisWeek = Supabase.startOfWeek(System.currentTimeMillis())
        val week = Prefs.week(app, widgetId)

        when (action) {
            // This week is the floor. Last week's sessions are history the app
            // shows better than a widget can, and a coach paging back through
            // last month on a home screen is not a real journey.
            ACTION_PREV -> Prefs.setWeek(app, widgetId, maxOf(Supabase.addDays(week, -7), thisWeek))
            ACTION_NEXT -> Prefs.setWeek(app, widgetId, Supabase.addDays(week, 7))
            ACTION_TODAY -> {
                Prefs.setWeek(app, widgetId, thisWeek)
                Prefs.requestJump(app, widgetId)
            }
        }
        if (action != ACTION_REFRESH) Prefs.saveState(app, widgetId, "loading")

        val pending = goAsync()
        // The date and arrows respond now. This frame never scrolls: every
        // action but ⟳ has just set the state to "loading", which buildFrame
        // refuses to jump from on purpose — the scroll belongs to the settled
        // frame the fetch brings back, and starting one here is what made NOW
        // stutter.
        paint(app, mgr, widgetId)?.let { scrollLater(app, mgr, widgetId, it) }
        scope.launch {
            try {
                refresh(app, mgr, widgetId)
            } finally {
                pending.finish()
            }
        }
    }
}
