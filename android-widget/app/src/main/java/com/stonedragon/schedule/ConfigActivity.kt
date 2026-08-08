package com.stonedragon.schedule

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Sign-in, once. The widget itself has no UI for this — a home screen is a bad
 * place for a password field, and Android gives a widget no way to show one.
 *
 * This is the normal coach email and password, the same pair as the web app.
 * What is kept afterwards is the refresh token, not the password.
 */
class ConfigActivity : AppCompatActivity() {

    /**
     * Ten colour dots, built from Theme.ACCENTS so the picker cannot disagree
     * with what the widget draws. The selected one wears a ring rather than a
     * tick — at 30dp a tick over a coloured circle is unreadable, and the ring
     * survives being the same colour as the dot.
     */
    /**
     * The five look settings.
     *
     * Every one applies IMMEDIATELY and repaints — there is no Save. This
     * screen is now reached from the widget's own ⚙ as well as from placement,
     * and a slider you have to confirm is a slider you cannot judge, because
     * the thing it changes is behind the screen you are standing on.
     *
     * CompoundButton for every switch, never Switch: AppCompat's inflater
     * quietly swaps <Switch> for SwitchCompat, which extends CompoundButton and
     * is NOT an android.widget.Switch. Asking for the latter compiles and then
     * throws the moment this screen opens.
     */
    private fun wireLookSettings() {
        val sat = findViewById<android.widget.SeekBar>(R.id.cfg_saturation)
        sat.progress = (Prefs.saturation(this) * 100).toInt()
        val opacity = findViewById<android.widget.SeekBar>(R.id.cfg_opacity)
        opacity.progress = (Prefs.opacity(this) * 100).toInt()

        // Repaint on RELEASE, not on every pixel of the drag: a widget repaint
        // crosses a process boundary, and firing one per progress tick makes
        // the slider stutter against its own updates.
        val onRelease = object : android.widget.SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(s: android.widget.SeekBar, p: Int, fromUser: Boolean) {}
            override fun onStartTrackingTouch(s: android.widget.SeekBar) {}
            override fun onStopTrackingTouch(s: android.widget.SeekBar) {
                when (s.id) {
                    R.id.cfg_saturation -> Prefs.setSaturation(this@ConfigActivity, s.progress / 100f)
                    R.id.cfg_opacity -> Prefs.setOpacity(this@ConfigActivity, s.progress / 100f)
                }
                ScheduleWidget.repaintAll(this@ConfigActivity)
            }
        }
        sat.setOnSeekBarChangeListener(onRelease)
        opacity.setOnSeekBarChangeListener(onRelease)

        val span = findViewById<android.widget.RadioGroup>(R.id.cfg_span)
        span.check(
            when (Prefs.spanDays(this)) {
                3 -> R.id.cfg_span_3
                14 -> R.id.cfg_span_14
                else -> R.id.cfg_span_7
            }
        )
        span.setOnCheckedChangeListener { _, checked ->
            Prefs.setSpanDays(
                this,
                when (checked) {
                    R.id.cfg_span_3 -> 3
                    R.id.cfg_span_14 -> 14
                    else -> 7
                },
            )
            // A refetch, not a repaint: the span decides how many days were
            // ASKED FOR, so the cache holds the wrong range until a new request
            // goes out. Repainting alone would draw 14 day-headers over a week
            // of data and read as a fortnight that is half empty.
            ScheduleWidget.refreshAll(this)
        }

        val compact = findViewById<android.widget.CompoundButton>(R.id.cfg_compact)
        val duration = findViewById<android.widget.CompoundButton>(R.id.cfg_duration)
        val notes = findViewById<android.widget.CompoundButton>(R.id.cfg_notes)

        compact.isChecked = Prefs.compact(this)
        duration.isChecked = Prefs.showDuration(this)
        notes.isChecked = Prefs.showNotes(this)
        // Compact owns the duration line, so the switch it overrides is greyed
        // rather than left looking live and doing nothing.
        duration.isEnabled = !compact.isChecked

        compact.setOnCheckedChangeListener { _, on ->
            Prefs.setCompact(this, on)
            duration.isEnabled = !on
            ScheduleWidget.repaintAll(this)
        }
        duration.setOnCheckedChangeListener { _, on ->
            Prefs.setShowDuration(this, on)
            ScheduleWidget.repaintAll(this)
        }
        notes.setOnCheckedChangeListener { _, on ->
            Prefs.setShowNotes(this, on)
            ScheduleWidget.repaintAll(this)
        }
    }

    private fun buildSwatches() {
        val host = findViewById<android.widget.LinearLayout>(R.id.cfg_swatches)
        host.removeAllViews()
        val light = Prefs.lightBg(this)
        val chosen = Prefs.accentId(this)
        val d = resources.displayMetrics.density
        val size = (34 * d).toInt()
        val gap = (10 * d).toInt()

        // Five per row. Ten across is wider than a phone, and the container
        // clips rather than scrolls, so the last five were unreachable.
        Theme.ACCENTS.chunked(5).forEach { chunk ->
            val row = android.widget.LinearLayout(this)
            row.orientation = android.widget.LinearLayout.HORIZONTAL
            row.layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.WRAP_CONTENT,
            ).apply { bottomMargin = gap }

            chunk.forEach { a ->
                val dot = View(this)
                val lp = android.widget.LinearLayout.LayoutParams(size, size)
                lp.rightMargin = gap
                dot.layoutParams = lp
                val shape = android.graphics.drawable.GradientDrawable().apply {
                    this.shape = android.graphics.drawable.GradientDrawable.OVAL
                    // The colour it will ACTUALLY be on the current surface, not
                    // the nominal one — otherwise the two that get swapped for
                    // legibility would preview as something never drawn.
                    setColor(Theme.accentFor(a.id, light))
                    if (a.id == chosen) {
                        setStroke((3 * d).toInt(), Theme.textColor(light))
                    }
                }
                dot.background = shape
                dot.contentDescription = a.label
                dot.setOnClickListener {
                    Prefs.setAccentId(this, a.id)
                    buildSwatches()
                    ScheduleWidget.repaintAll(this)
                }
                row.addView(dot)
            }
            host.addView(row)
        }
    }

    private lateinit var email: EditText
    private lateinit var password: EditText
    private lateinit var button: Button
    private lateinit var status: TextView
    private lateinit var signedIn: TextView
    private lateinit var diag: TextView
    private lateinit var testButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_config)

        email = findViewById(R.id.cfg_email)
        password = findViewById(R.id.cfg_password)
        button = findViewById(R.id.cfg_button)
        status = findViewById(R.id.cfg_status)
        signedIn = findViewById(R.id.cfg_signed_in)
        diag = findViewById(R.id.cfg_diag)
        testButton = findViewById(R.id.cfg_test)

        email.setText(Prefs.email(this))
        buildSwatches()
        // CompoundButton, not Switch: AppCompat's inflater quietly swaps a
        // <Switch> for a SwitchCompat, which extends CompoundButton and is NOT
        // a subclass of android.widget.Switch — asking for the latter compiles
        // and then throws ClassCastException the moment this screen opens.
        val lightSwitch = findViewById<android.widget.CompoundButton>(R.id.cfg_light)
        lightSwitch.isChecked = Prefs.lightBg(this)
        lightSwitch.setOnCheckedChangeListener { _, on ->
            Prefs.setLightBg(this, on)
            buildSwatches() // the two unreadable accents swap when the surface does
            ScheduleWidget.repaintAll(this)
        }
        wireLookSettings()
        renderState()

        // A crash recorded since last time is the most useful thing on this
        // screen, so it opens showing it rather than waiting to be asked.
        CrashLog.last(this)?.let { diag.text = it }

        // (swatch construction lives in buildSwatches, below)
        // (the look settings live in wireLookSettings, below)

        // Runs the widget's own query and prints what came back. The widget has
        // one line of text to explain itself with, which is not enough to tell a
        // free day from a rejected token from a stale frame.
        testButton.setOnClickListener {
            testButton.isEnabled = false
            // Read before anything can overwrite it: a crash from the last run
            // is context for this report, not noise to be cleared away first.
            val priorCrash = CrashLog.last(this)
            diag.text = getString(R.string.testing)
            CoroutineScope(Dispatchers.IO).launch {
                val report = try {
                    // Force the widgets through a real fetch and repaint first,
                    // so the summary below describes what they have just been
                    // told rather than whatever they were left holding.
                    ScheduleWidget.refreshBlocking(this@ConfigActivity)
                    Supabase.selfTest(this@ConfigActivity) + "\n" +
                        ScheduleWidget.debugSummary(this@ConfigActivity) +
                        "\n\nEvents:\n" + Prefs.trace(this@ConfigActivity)
                } catch (e: Exception) {
                    CrashLog.record(this@ConfigActivity, e, "selfTest")
                    "Test threw: " + (e.message ?: e.javaClass.simpleName)
                }
                withContext(Dispatchers.Main) {
                    diag.text = if (priorCrash != null) "$report\n\n$priorCrash" else report
                    testButton.isEnabled = true
                    renderState() // the query may have cleared a dead session
                }
            }
        }

        button.setOnClickListener {
            if (Supabase.isSignedIn(this)) {
                // Wrapped because this used to take the app down and there was
                // then no way to sign out at all — a dead end reachable only by
                // clearing the app's storage from Android settings.
                try {
                    Supabase.signOut(this)
                    ScheduleWidget.signedOutAll(this)
                } catch (e: Exception) {
                    CrashLog.record(this, e, "signOut")
                }
                renderState()
                return@setOnClickListener
            }
            val e = email.text.toString().trim()
            val p = password.text.toString()
            if (e.isEmpty() || p.isEmpty()) {
                status.text = getString(R.string.needs_both)
                return@setOnClickListener
            }
            button.isEnabled = false
            status.text = getString(R.string.signing_in)
            CoroutineScope(Dispatchers.IO).launch {
                val error = Supabase.signIn(this@ConfigActivity, e, p)
                withContext(Dispatchers.Main) {
                    button.isEnabled = true
                    if (error == null) {
                        Prefs.saveEmail(this@ConfigActivity, e)
                        password.setText("")
                        status.text = ""
                        renderState()
                        ScheduleWidget.refreshAll(this@ConfigActivity)
                        // Launched from the widget's "Tap to sign in": the job
                        // is done, so get out of the way rather than sitting on
                        // a form with nothing left to fill in.
                        if (intent?.action == null) finish()
                    } else {
                        status.text = error
                    }
                }
            }
        }
    }

    /**
     * Opening this screen repaints every widget, and refetches when signed in.
     * Cheap insurance: whatever else went wrong, the act of opening the app is
     * now enough to put a stale widget right, instead of leaving the coach with
     * a home screen that disagrees with the app and no way to reconcile them.
     */
    override fun onResume() {
        super.onResume()
        try {
            ScheduleWidget.repaintAll(this)
            if (Supabase.isSignedIn(this)) ScheduleWidget.refreshAll(this)
        } catch (e: Exception) {
            CrashLog.record(this, e, "onResume")
        }
    }

    private fun renderState() {
        val on = Supabase.isSignedIn(this)
        signedIn.visibility = if (on) View.VISIBLE else View.GONE
        email.visibility = if (on) View.GONE else View.VISIBLE
        password.visibility = if (on) View.GONE else View.VISIBLE
        button.text = getString(if (on) R.string.sign_out else R.string.sign_in)
        if (on) {
            signedIn.text = getString(R.string.signed_in_as, Prefs.email(this))
        }
    }
}
