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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_config)

        email = findViewById(R.id.cfg_email)
        password = findViewById(R.id.cfg_password)
        button = findViewById(R.id.cfg_button)
        status = findViewById(R.id.cfg_status)
        signedIn = findViewById(R.id.cfg_signed_in)

        email.setText(Prefs.email(this))
        renderState()

        button.setOnClickListener {
            if (Supabase.isSignedIn(this)) {
                Supabase.signOut(this)
                ScheduleWidget.refreshAll(this)
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
