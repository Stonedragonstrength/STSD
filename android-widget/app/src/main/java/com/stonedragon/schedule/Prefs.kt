package com.stonedragon.schedule

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Everything that survives between widget updates.
 *
 * The session lives in app-private SharedPreferences, which no other app can
 * read on a non-rooted device. That is a deliberate first-cut choice, not an
 * oversight: EncryptedSharedPreferences would pull in Tink, and this build is
 * sideloaded onto one coach's own phone. Worth revisiting before it goes to
 * anyone else's.
 *
 * The rendered day is stored PER WIDGET ID, so two copies of the widget can sit
 * on different screens showing different days.
 */
object Prefs {

    private const val FILE = "sd_schedule"

    private const val K_ACCESS = "access_token"
    private const val K_REFRESH = "refresh_token"
    private const val K_EXPIRES = "expires_at"
    private const val K_EMAIL = "email"

    private fun p(ctx: Context) = ctx.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    // ---- session ----

    fun saveSession(ctx: Context, access: String, refresh: String, expiresAt: Long) {
        p(ctx).edit()
            .putString(K_ACCESS, access)
            .putString(K_REFRESH, refresh)
            .putLong(K_EXPIRES, expiresAt)
            .apply()
    }

    fun accessToken(ctx: Context): String? = p(ctx).getString(K_ACCESS, null)
    fun refreshToken(ctx: Context): String? = p(ctx).getString(K_REFRESH, null)
    fun expiresAt(ctx: Context): Long = p(ctx).getLong(K_EXPIRES, 0L)

    fun saveEmail(ctx: Context, email: String) = p(ctx).edit().putString(K_EMAIL, email).apply()
    fun email(ctx: Context): String = p(ctx).getString(K_EMAIL, "").orEmpty()

    fun clearSession(ctx: Context) {
        p(ctx).edit().remove(K_ACCESS).remove(K_REFRESH).remove(K_EXPIRES).apply()
    }

    // ---- which day each widget is showing ----

    /**
     * Local midnight of the day this widget renders. Defaults to today, and
     * re-defaults to today whenever the stored day is in the past — a widget
     * left on "tomorrow" overnight should come back as a today view, not
     * silently keep showing yesterday.
     */
    fun day(ctx: Context, widgetId: Int): Long {
        val stored = p(ctx).getLong(dayKey(widgetId), 0L)
        val today = Supabase.startOfDay(System.currentTimeMillis())
        return if (stored < today) today else stored
    }

    fun setDay(ctx: Context, widgetId: Int, dayStart: Long) {
        p(ctx).edit().putLong(dayKey(widgetId), dayStart).apply()
    }

    fun forgetWidget(ctx: Context, widgetId: Int) {
        p(ctx).edit()
            .remove(dayKey(widgetId))
            .remove(cacheKey(widgetId))
            .remove(cacheDayKey(widgetId))
            .remove(stateKey(widgetId))
            .apply()
    }

    private fun dayKey(id: Int) = "day_$id"
    private fun cacheKey(id: Int) = "cache_$id"
    private fun cacheDayKey(id: Int) = "cacheday_$id"
    private fun stateKey(id: Int) = "state_$id"

    // ---- last fetch, cached so the list survives a redraw ----
    //
    // RemoteViewsFactory runs in a separate process from the provider and cannot
    // be handed data directly, so the fetch writes here and the factory reads it
    // back. It doubles as the offline cache: a widget woken with no signal shows
    // the last day it managed to load rather than going blank.

    /**
     * The cache is stamped with the day it holds. Without that stamp it cannot
     * be shown after a failed fetch — yesterday's sessions under tomorrow's date
     * is worse than an empty widget, and telling the two apart needs the day.
     */
    fun saveBookings(ctx: Context, widgetId: Int, day: Long, bookings: List<Booking>) {
        val arr = JSONArray()
        for (b in bookings) {
            arr.put(
                JSONObject()
                    .put("id", b.id)
                    .put("start", b.startMillis)
                    .put("end", b.endMillis)
                    .put("athlete", b.athlete)
                    .put("note", b.note)
            )
        }
        p(ctx).edit()
            .putString(cacheKey(widgetId), arr.toString())
            .putLong(cacheDayKey(widgetId), day)
            .apply()
    }

    /** Cached sessions, but only if they are for [day]. */
    fun bookings(ctx: Context, widgetId: Int, day: Long): List<Booking> {
        if (p(ctx).getLong(cacheDayKey(widgetId), -1L) != day) return emptyList()
        val raw = p(ctx).getString(cacheKey(widgetId), null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).mapNotNull { i ->
                arr.optJSONObject(i)?.let { o ->
                    Booking(
                        id = o.optString("id"),
                        startMillis = o.optLong("start"),
                        endMillis = o.optLong("end"),
                        athlete = o.optString("athlete"),
                        note = o.optString("note"),
                    )
                }
            }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /**
     * "ok" | "partial" | "signin" | "error:<message>" | "loading" — drives the
     * empty view.
     */
    fun saveState(ctx: Context, widgetId: Int, state: String) {
        p(ctx).edit().putString(stateKey(widgetId), state).apply()
    }

    fun state(ctx: Context, widgetId: Int): String =
        p(ctx).getString(stateKey(widgetId), "loading").orEmpty()

    /**
     * Whether to draw the cached list. Lives here because the provider and the
     * list factory both have to agree — when they disagreed, the header counted
     * sessions the list refused to show.
     *
     * A failed refresh still draws: the cache is day-stamped, so if it holds the
     * day being shown it is the last true answer for that day, and showing it is
     * the entire point of caching. Only a signed-out widget draws nothing, since
     * then the cache is cleared anyway. This was the bug that left a widget with
     * seven sessions stored showing an empty list because one fetch failed.
     */
    fun isLoaded(state: String): Boolean = state != "signin"
}
