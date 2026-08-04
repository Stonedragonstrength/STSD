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
        renderState()

        // A crash recorded since last time is the most useful thing on this
        // screen, so it opens showing it rather than waiting to be asked.
        CrashLog.last(this)?.let { diag.text = it }

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
