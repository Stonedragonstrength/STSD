package com.stonedragon.schedule

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * One session on the coach's day.
 *
 * `athlete` is the athlete's display_name, embedded by PostgREST through the
 * bookings -> athletes foreign key. It can come back blank if the athlete row
 * was deleted but the booking survived, so the UI must not assume it is there.
 */
data class Booking(
    val id: String,
    val startMillis: Long,
    val endMillis: Long,
    val athlete: String,
    /**
     * Who this is, for colouring. Blank on legacy `setmore_events` rows, which
     * carry only a name — those fall back to hashing the name and will NOT
     * match the colour the web app gives that athlete. Accepted rather than
     * fixed: Setmore is switched off and those rows are history.
     */
    val athleteId: String,
    val note: String,
)

/**
 * What a refresh produced. The widget renders each of these differently.
 *
 * `partial` means one of the two schedule sources answered and the other did
 * not. The day is shown anyway — half a schedule beats none — but it is flagged,
 * because silently dropping sessions is the one failure a coach cannot catch.
 */
sealed class FetchResult {
    data class Ok(val bookings: List<Booking>, val partial: Boolean = false) : FetchResult()
    object NotSignedIn : FetchResult()
    data class Failed(val message: String) : FetchResult()
}

/**
 * Talks to Supabase over plain HttpURLConnection and org.json — both are in the
 * platform, so the widget carries no networking or JSON dependency of its own.
 * That matters more than usual here: a home-screen widget is woken by the
 * launcher, and every dependency is something that has to load before a list of
 * four appointments can be drawn.
 */
object Supabase {

    private const val TIMEOUT_MS = 15_000

    // ---- auth ----

    /**
     * Exchanges an email and password for a session. Called once, from the
     * config screen. Returns null on success, or a human-readable reason.
     */
    fun signIn(ctx: Context, email: String, password: String): String? {
        val body = JSONObject()
            .put("email", email.trim())
            .put("password", password)
            .toString()
        return try {
            val res = post("/auth/v1/token?grant_type=password", body, auth = null)
            storeSession(ctx, res)
            null
        } catch (e: ApiError) {
            // Supabase returns error_description for auth failures and message
            // for everything else; neither is always present.
            e.friendly ?: "Sign-in failed"
        } catch (e: Exception) {
            e.message ?: "Could not reach Supabase"
        }
    }

    fun signOut(ctx: Context) = Prefs.clearSession(ctx)

    fun isSignedIn(ctx: Context) = Prefs.refreshToken(ctx) != null

    /**
     * Runs the widget's real query and describes exactly what came back, for the
     * diagnostic on the config screen. Deliberately the same code path the
     * widget uses — a test that proves a *different* request works proves
     * nothing about the one that is failing.
     */
    fun selfTest(ctx: Context): String {
        val sb = StringBuilder()
        val hasRefresh = Prefs.refreshToken(ctx) != null
        sb.append("Session: ").append(if (hasRefresh) "present" else "NONE").append('\n')
        if (hasRefresh) {
            val left = (Prefs.expiresAt(ctx) - System.currentTimeMillis()) / 60000
            sb.append("Access token: ")
                .append(if (Prefs.accessToken(ctx) == null) "none stored" else "expires in ${left}m")
                .append('\n')
        }
        if (!hasRefresh) {
            sb.append("\nNothing to query without a session.")
            return sb.toString()
        }
        // The WEEK, not today. This test used to query only today, so a widget
        // that could load today and nothing else — which is exactly what got
        // reported — passed it cleanly and proved nothing.
        val week = startOfWeek(System.currentTimeMillis())
        when (val r = bookingsForWeek(ctx, week)) {
            is FetchResult.Ok -> {
                sb.append("Query: OK, ").append(r.bookings.size).append(" session(s) this week")
                if (r.partial) sb.append(" (one source failed)")
                sb.append('\n')
                // Per-day counts, so "the week loaded but one day is empty" is
                // distinguishable from "the whole week is empty" at a glance.
                val dayFmt = SimpleDateFormat("EEE d", Locale.getDefault())
                for (i in 0 until 7) {
                    val from = addDays(week, i)
                    val to = addDays(week, i + 1)
                    val n = r.bookings.count { it.startMillis >= from && it.startMillis < to }
                    sb.append("  ").append(dayFmt.format(Date(from)))
                        .append(": ").append(n).append('\n')
                }
                r.bookings.take(3).forEach {
                    sb.append("  • ")
                        .append(SimpleDateFormat("EEE h:mma", Locale.getDefault()).format(Date(it.startMillis)))
                        .append(' ')
                        .append(it.athlete.ifBlank { "(no name)" })
                        .append(if (it.id.startsWith("sm:")) "  [setmore]" else "  [bookings]")
                        .append('\n')
                }
                // The session surviving the query is the thing worth reporting:
                // a rejected refresh clears it, which is what turns a working
                // widget into "Tap to sign in" with no other symptom.
                if (Prefs.refreshToken(ctx) == null) {
                    sb.append("WARNING: the session was cleared during this query.\n")
                }
            }
            is FetchResult.NotSignedIn ->
                sb.append("Query: the server rejected the session — it has been cleared.\n")
            is FetchResult.Failed ->
                sb.append("Query: FAILED — ").append(r.message).append('\n')
        }
        return sb.toString()
    }

    /**
     * A valid access token, refreshing it first if it is within a minute of
     * expiring. Returns null when there is no session at all, or when the
     * refresh token has been revoked — both mean "send them back to sign-in".
     */
    /**
     * Synchronized because a Supabase refresh token is single-use: refreshing it
     * mints a new one and kills the old. Two threads arriving together — a widget
     * update and a tap, say — would both send the same token, and the loser's 400
     * used to clear the whole session. The second caller now waits, re-reads, and
     * finds the token the first one just stored.
     */
    @Synchronized
    private fun accessToken(ctx: Context): String? {
        val refresh = Prefs.refreshToken(ctx) ?: return null
        val token = Prefs.accessToken(ctx)
        if (token != null && Prefs.expiresAt(ctx) > System.currentTimeMillis() + 60_000) return token
        return try {
            val res = post(
                "/auth/v1/token?grant_type=refresh_token",
                JSONObject().put("refresh_token", refresh).toString(),
                auth = null,
            )
            storeSession(ctx, res)
            res.optString("access_token").ifEmpty { null }
        } catch (e: ApiError) {
            // 400/401 means the server rejected the refresh token. Only treat
            // that as a dead session if the token has not changed underneath us
            // — if it has, another thread refreshed successfully while this call
            // was in flight, and signing the coach out over that would be wrong.
            if (e.status == 400 || e.status == 401) {
                if (Prefs.refreshToken(ctx) == refresh) {
                    Prefs.clearSession(ctx)
                } else {
                    return Prefs.accessToken(ctx)
                }
            }
            null
        } catch (e: Exception) {
            // A network failure is not a dead session — leave it alone, so a
            // refresh attempted on a train does not sign the coach out.
            null
        }
    }

    private fun storeSession(ctx: Context, res: JSONObject) {
        val access = res.optString("access_token")
        val refresh = res.optString("refresh_token")
        val expiresIn = res.optLong("expires_in", 3600L)
        if (access.isEmpty() || refresh.isEmpty()) throw ApiError(0, "No session returned")
        Prefs.saveSession(
            ctx,
            access = access,
            refresh = refresh,
            expiresAt = System.currentTimeMillis() + expiresIn * 1000L,
        )
    }

    // ---- the one query the widget makes ----

    /**
     * Every session on [dayStart]'s local calendar day.
     *
     * `bookings` is the source of truth — scheduling lives in the app now. The
     * legacy `setmore_events` table is still read because switching Setmore off
     * deliberately leaves its existing rows alone (they are the only record of
     * sessions made before the app took over), so an already-scheduled upcoming
     * session can still exist only there. Once that table stops returning rows
     * for future days this second call answers with an empty list and can be
     * deleted. The web app's own day view merges exactly these two sources.
     *
     * Neither query filters on coach_id: the "coach manages own bookings" and
     * "coach reads own setmore events" RLS policies already scope both to
     * whoever is signed in, so a filter here would only be a second place to
     * get it wrong.
     */
    /** Sunday to Saturday inclusive, in one pair of requests. */
    fun bookingsForWeek(ctx: Context, weekStart: Long): FetchResult =
        bookingsForRange(ctx, weekStart, 7)

    /**
     * [days] whole calendar days from [dayStart].
     *
     * One request per table for the entire span rather than seven per table:
     * a widget refresh happens on a launcher's schedule and on a phone radio,
     * and fourteen round trips to draw one screen is how a refresh ends up
     * half-finished when the process is killed.
     */
    fun bookingsForRange(ctx: Context, dayStart: Long, days: Int): FetchResult {
        // accessToken() clears the stored session only when the server itself
        // rejected the refresh token. If a session is still stored after a null,
        // the refresh simply could not happen — a launcher-scheduled wake with
        // the radio asleep, mostly. That is "couldn't load", not "signed out":
        // reporting it as sign-out painted "Tap to sign in" on the home screen
        // while the app was signed in fine, and that frame sat there until the
        // next successful refresh happened to repaint it.
        val token = accessToken(ctx)
            ?: return if (Prefs.refreshToken(ctx) != null) {
                FetchResult.Failed("Couldn't refresh")
            } else {
                FetchResult.NotSignedIn
            }
        // Whole calendar days, so the window is still right across a DST change
        // — dayStart + 24h lands an hour early or late on those two days a year
        // and would clip or double-count a session at the boundary.
        val from = isoUtc(dayStart)
        val to = isoUtc(addDays(dayStart, days))

        val out = ArrayList<Booking>()
        // Every slot the app owns, cancelled bookings INCLUDED — see below.
        val ownedSlots = HashSet<Long>()
        var failed = 0
        var unauthorized = false

        fun run(block: () -> Unit) {
            try {
                block()
            } catch (e: ApiError) {
                if (e.status == 401) unauthorized = true else failed++
            } catch (e: Exception) {
                failed++
            }
        }

        run {
            val native = fetchNative(token, from, to)
            out += native.booked
            ownedSlots += native.slots
        }
        run { out += fetchSetmore(token, from, to) }

        if (unauthorized) {
            Prefs.clearSession(ctx)
            return FetchResult.NotSignedIn
        }
        if (failed == 2) return FetchResult.Failed("Couldn't load")

        // After the bail-outs — there is nothing to filter until there is
        // something to draw. Not counted in `failed` either: a coach row that
        // will not load is a reason to show the sessions anyway, not to call
        // the whole week partial. Infinity then keeps every mirrored event,
        // which is exactly the pre-cutover behaviour.
        val cutoff = try {
            setmoreCutoff(token)
        } catch (e: Exception) {
            Long.MAX_VALUE
        }

        // A session that exists in both tables is one session. The native row
        // wins: it knows the athlete and the note.
        //
        // Matched on START TIME ALONE, deliberately. This used to key on time
        // PLUS the athlete's name, which assumed the two tables spell people
        // identically — and they do not. One athlete is "Alyssa Steilstra" in
        // `athletes` and "Alyssa Stielstra" in `setmore_events`, so her two rows
        // never collapsed and every one of her sessions was drawn twice. A
        // legacy mirror row is a duplicate of whatever native booking occupies
        // its slot whatever either side calls the person; the coach cannot be in
        // two places at 7am, so the time is the identity.
        //
        // The slot set comes from EVERY native booking, cancelled ones included,
        // while only the booked ones are drawn. Once the app owns a slot the
        // mirror is dead for it whatever happens next — otherwise cancelling a
        // booking HANDS THE SLOT BACK to the mirror and the session the coach
        // just cancelled reappears under the athlete's name. app.js closed this
        // hole on 2026-08-05 after it double-charged two athletes; the widget
        // was left behind, still filtering `status=eq.booked` server side, which
        // is what put deleted clients back on the home screen.
        val merged = out
            .sortedWith(compareBy({ it.startMillis }, { if (it.id.startsWith("sm:")) 1 else 0 }))
            // Only the legacy side is ever dropped. Two NATIVE bookings at the
            // same time are two real sessions and both survive.
            .filter { b ->
                if (!b.id.startsWith("sm:")) return@filter true
                // Past the cut-over the app owns the calendar outright, so a
                // mirrored event from then on is a leftover, not a session.
                // Without this the widget shows a week the app does not.
                b.startMillis < cutoff && slotKey(b.startMillis) !in ownedSlots
            }

        return FetchResult.Ok(merged, partial = failed > 0)
    }

    /**
     * The instant Setmore was switched off, from `coaches.availability` — the
     * same JSON the web app reads. Long.MAX_VALUE when it has never been set,
     * matching app.js's fallback to Infinity: before a cut-over every mirrored
     * event is still real.
     *
     * No coach_id filter, like the other two queries: RLS returns this coach's
     * row and nobody else's.
     */
    private fun setmoreCutoff(token: String): Long {
        val arr = getArray("/rest/v1/coaches?select=" + enc("availability") + "&limit=1", token)
        val av = arr.optJSONObject(0)?.optJSONObject("availability") ?: return Long.MAX_VALUE
        val raw = av.optString("setmoreCutoff")
        if (raw.isBlank()) return Long.MAX_VALUE
        return parseIso(raw) ?: Long.MAX_VALUE
    }

    /**
     * The native side of the week: the bookings to draw, and every slot the app
     * has claimed. They are not the same set — see the merge in bookingsForRange.
     */
    private class NativeRows(val booked: List<Booking>, val slots: Set<Long>)

    /**
     * A slot identity, to the MINUTE — the same coarseness app.js uses, and for
     * the same reason: the lock-in built each booking from its Setmore slot, so
     * the two agree to the minute, and a minute survives a stored second's
     * drift that exact-millis equality would not. There is no such drift in the
     * data today (checked, 2026-08-06: zero pairs agree on the minute and
     * disagree on the second) — this is so that a single stray second can never
     * quietly put a cancelled session back on the home screen.
     */
    private fun slotKey(startMillis: Long): Long = startMillis / 60_000L

    private fun fetchNative(token: String, from: String, to: String): NativeRows {
        // No `status=eq.booked` here on purpose: a cancelled booking is not
        // drawn, but it still has to be READ, because its slot is what keeps the
        // legacy mirror from speaking for it.
        val path = "/rest/v1/bookings" +
            "?select=" + enc("id,start_at,end_at,note,status,athlete_id,athletes(display_name)") +
            "&start_at=gte." + enc(from) +
            "&start_at=lt." + enc(to) +
            "&order=" + enc("start_at.asc")
        val arr = getArray(path, token)
        val booked = ArrayList<Booking>(arr.length())
        val slots = HashSet<Long>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val start = parseIso(o.optString("start_at")) ?: continue
            // Claimed first, drawn second. Every row claims its slot; only a
            // booked one is a session.
            slots.add(slotKey(start))
            if (o.optString("status") != "booked") continue
            booked.add(
                Booking(
                    id = o.optString("id"),
                    startMillis = start,
                    endMillis = parseIso(o.optString("end_at")) ?: start,
                    athlete = o.optJSONObject("athletes")?.optString("display_name").orEmpty(),
                    athleteId = o.optString("athlete_id"),
                    note = cleanText(o.optString("note")),
                )
            )
        }
        return NativeRows(booked, slots)
    }

    private fun fetchSetmore(token: String, from: String, to: String): List<Booking> {
        val path = "/rest/v1/setmore_events" +
            "?select=" + enc("external_uid,client_name,title,start_at,end_at") +
            "&start_at=gte." + enc(from) +
            "&start_at=lt." + enc(to) +
            "&order=" + enc("start_at.asc")
        val arr = getArray(path, token)
        val out = ArrayList<Booking>(arr.length())
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val start = parseIso(o.optString("start_at")) ?: continue
            out.add(
                Booking(
                    // Prefixed so it can never collide with a bookings id, the
                    // same guard the web app uses for the opposite direction.
                    id = "sm:" + o.optString("external_uid"),
                    startMillis = start,
                    endMillis = parseIso(o.optString("end_at")) ?: start,
                    athlete = cleanText(o.optString("client_name"))
                        .ifBlank { cleanText(o.optString("title")) },
                    // The mirror carries no athlete id — the name is all there is.
                    athleteId = "",
                    note = "",
                )
            )
        }
        return out
    }

    /** org.json hands back the literal string "null" for a JSON null. */
    private fun cleanText(s: String?): String =
        if (s == null || s == "null") "" else s.trim()

    // ---- plumbing ----

    private class ApiError(val status: Int, val friendly: String?) : Exception(friendly)

    private fun conn(path: String, token: String?): HttpURLConnection {
        val c = URL(BuildConfig.SUPABASE_URL + path).openConnection() as HttpURLConnection
        c.connectTimeout = TIMEOUT_MS
        c.readTimeout = TIMEOUT_MS
        c.setRequestProperty("apikey", BuildConfig.SUPABASE_ANON_KEY)
        c.setRequestProperty("Authorization", "Bearer " + (token ?: BuildConfig.SUPABASE_ANON_KEY))
        c.setRequestProperty("Accept", "application/json")
        return c
    }

    private fun post(path: String, body: String, auth: String?): JSONObject {
        val c = conn(path, auth)
        c.requestMethod = "POST"
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(body.toByteArray()) }
        return JSONObject(readOrThrow(c))
    }

    private fun getArray(path: String, token: String): JSONArray {
        val c = conn(path, token)
        c.requestMethod = "GET"
        return JSONArray(readOrThrow(c))
    }

    private fun readOrThrow(c: HttpURLConnection): String {
        val status = c.responseCode
        val stream = if (status in 200..299) c.inputStream else c.errorStream
        val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()
        if (status in 200..299) return text
        throw ApiError(status, friendlyError(text))
    }

    /** Pulls whichever field this particular Supabase surface used this time. */
    private fun friendlyError(body: String): String? = try {
        val o = JSONObject(body)
        listOf("error_description", "msg", "message", "error", "hint")
            .firstNotNullOfOrNull { o.optString(it).takeIf(String::isNotEmpty) }
    } catch (e: Exception) {
        null
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    // ---- dates ----

    private fun isoUtc(millis: Long): String {
        val f = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        f.timeZone = TimeZone.getTimeZone("UTC")
        return f.format(Date(millis))
    }

    /**
     * Postgres hands back timestamptz as ...+00:00 or ...Z, with a fractional
     * second that may be 0, 3 or 6 digits. Parsing the offset by hand is
     * cheaper than carrying a date library into a widget process.
     */
    fun parseIso(s: String?): Long? {
        if (s.isNullOrEmpty()) return null
        val cleaned = s.trim()
            .replace(Regex("\\.\\d+"), "")
            .replace("+00:00", "Z")
            .replace(Regex("([+-]\\d{2}):(\\d{2})$"), "$1$2")
        val patterns = listOf("yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ssZ")
        for (p in patterns) {
            try {
                val f = SimpleDateFormat(p, Locale.US)
                if (p.endsWith("'Z'")) f.timeZone = TimeZone.getTimeZone("UTC")
                return f.parse(cleaned)?.time
            } catch (e: Exception) {
                // try the next shape
            }
        }
        return null
    }

    /** Local midnight for the day [millis] falls in. */
    fun startOfDay(millis: Long): Long {
        val c = Calendar.getInstance()
        c.timeInMillis = millis
        c.set(Calendar.HOUR_OF_DAY, 0)
        c.set(Calendar.MINUTE, 0)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    /**
     * Local midnight on the SUNDAY of the week [millis] falls in.
     *
     * Deliberately not Calendar.getFirstDayOfWeek(): that follows the phone's
     * region setting, and the coach reads his week Sunday to Saturday wherever
     * the phone thinks it is. Hard-coding it makes the widget agree with how he
     * actually plans.
     *
     * This anchored to MONDAY until Aug 2026. Anything that persists a window
     * start across that change has to re-anchor it rather than trust it — see
     * Prefs.windowStart.
     */
    fun startOfWeek(millis: Long): Long {
        val c = Calendar.getInstance()
        c.timeInMillis = startOfDay(millis)
        // Calendar.SUNDAY is 1, the lowest DAY_OF_WEEK, so this is simply the
        // distance from it. The + 7 % 7 is kept rather than simplified away
        // because it is what keeps the arithmetic right if the anchor ever
        // moves off the first day of the week again.
        val back = (c.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY + 7) % 7
        c.add(Calendar.DAY_OF_YEAR, -back)
        return c.timeInMillis
    }

    /**
     * Steps whole calendar days, not fixed 24-hour blocks — adding 24h across
     * a DST boundary lands at 23:00 the previous day and the widget would show
     * the wrong date.
     */
    fun addDays(dayStart: Long, days: Int): Long {
        val c = Calendar.getInstance()
        c.timeInMillis = dayStart
        c.add(Calendar.DAY_OF_YEAR, days)
        return c.timeInMillis
    }
}
