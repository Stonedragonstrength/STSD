package com.stonedragon.schedule

import android.app.Application
import android.content.Context
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Keeps the last crash where it can be read without a cable.
 *
 * This app is sideloaded onto one phone and driven by someone who cannot run
 * logcat, so "it crashed" is otherwise the entire bug report. The stack trace
 * goes into prefs and the config screen shows it on the next launch.
 */
object CrashLog {

    private const val K_TRACE = "last_crash"
    private const val K_WHEN = "last_crash_at"

    private fun p(ctx: Context) = ctx.getSharedPreferences("sd_schedule", Context.MODE_PRIVATE)

    fun record(ctx: Context?, t: Throwable, where: String) {
        val c = ctx ?: App.context ?: return
        val sw = StringWriter()
        t.printStackTrace(PrintWriter(sw))
        // Trimmed: the config screen has to show this on a phone, and the top of
        // a stack trace is where the answer is.
        val trace = sw.toString().lineSequence().take(12).joinToString("\n")
        p(c).edit()
            .putString(K_TRACE, "[$where] $trace")
            .putLong(K_WHEN, System.currentTimeMillis())
            .apply()
    }

    fun last(ctx: Context): String? {
        val trace = p(ctx).getString(K_TRACE, null) ?: return null
        val at = p(ctx).getLong(K_WHEN, 0L)
        val stamp = if (at > 0) {
            SimpleDateFormat("d MMM HH:mm", Locale.getDefault()).format(Date(at))
        } else {
            "unknown time"
        }
        return "Last crash ($stamp):\n$trace"
    }

    fun clear(ctx: Context) {
        p(ctx).edit().remove(K_TRACE).remove(K_WHEN).apply()
    }
}

/**
 * Exists to hold an application Context for [CrashLog] and to install the
 * uncaught-exception handler process-wide, so a crash in the widget receiver is
 * recorded the same as one in the activity.
 */
class App : Application() {

    companion object {
        @Volatile
        var context: Context? = null
            private set
    }

    override fun onCreate() {
        super.onCreate()
        context = applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            CrashLog.record(applicationContext, throwable, "uncaught/${thread.name}")
            // Chained, not swallowed: the process still dies and Android still
            // shows its dialog. Pretending a crash did not happen would leave
            // the app in whatever state caused it.
            previous?.uncaughtException(thread, throwable)
        }
    }
}
