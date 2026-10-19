package app.bopomofo.auto.phone

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import app.bopomofo.auto.BopomofoApp
import app.bopomofo.auto.net.Auth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The phone side: sign in on the bopomofo.app sign-in page, allow the microphone, and a few settings.
 * Practice itself happens on the car screen.
 */
class MainActivity : Activity() {
    private val app by lazy { BopomofoApp.of(this) }
    private val scope = MainScope()
    private val handler = Handler(Looper.getMainLooper())
    private var checking = false
    private var lastCookie: String? = null
    private val poll = object : Runnable {
        override fun run() {
            checkSignIn()
            handler.postDelayed(this, 2500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (app.auth.signedIn) showStatus() else showSignIn()
    }

    override fun onResume() {
        super.onResume()
        if (app.auth.signedIn) showStatus()
    }

    override fun onDestroy() {
        handler.removeCallbacks(poll)
        scope.cancel()
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showSignIn() {
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        val web = WebView(this)
        cookies.setAcceptThirdPartyCookies(web, true)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) = checkSignIn()
        }
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(text("Sign in to Bopomofo", 20f, bold = true).apply { setPadding(dp(16), dp(16), dp(16), dp(8)) })
        root.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        web.loadUrl(Auth.SIGN_IN_URL)
        handler.removeCallbacks(poll)
        handler.postDelayed(poll, 2500)
    }

    /** Clerk keeps the browser client in the __client cookie. Once it holds an active session, the app keeps it. */
    private fun checkSignIn() {
        if (checking || app.auth.signedIn) return
        val all = CookieManager.getInstance().getCookie(Auth.CLERK_URL) ?: return
        val value = all.split(';').map { it.trim() }.firstOrNull { it.startsWith("__client=") }?.substringAfter('=') ?: return
        checking = true
        scope.launch {
            val c = withContext(Dispatchers.IO) { runCatching { app.auth.inspect(value) }.getOrNull() }
            checking = false
            lastCookie = value
            if (c?.session != null) {
                app.auth.adopt(c)
                CookieManager.getInstance().flush()
                handler.removeCallbacks(poll)
                showStatus()
            }
        }
    }

    private fun showStatus() {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(24), dp(20), dp(24))
        }
        col.addView(text("Bopomofo for Android Auto", 24f, bold = true))
        val name = app.auth.name
        col.addView(text(if (name.isNotEmpty()) "Signed in as $name." else "Signed in.", 16f).apply { setPadding(0, dp(8), 0, dp(16)) })

        val mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        col.addView(text(if (mic) "Microphone: allowed." else "Microphone: not allowed yet. The Speak exercises need it.", 16f))
        if (!mic) {
            col.addView(Button(this).apply {
                text = "Allow the microphone"
                setOnClickListener { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1) }
            })
        }

        col.addView(CheckBox(this).apply {
            text = "Repeat modes: play the model before I speak. Recordings after it count as helped, like Cheat on the web."
            isChecked = app.playFirst
            setOnCheckedChangeListener { _, v -> app.playFirst = v }
            setPadding(0, dp(16), 0, dp(16))
        })

        col.addView(text("In the car", 18f, bold = true).apply { setPadding(0, dp(8), 0, dp(4)) })
        col.addView(
            text(
                "Connect the phone to the car and pick Bopomofo in the Android Auto app list.\n\n" +
                    "This app does not come from the Play Store, so Android Auto hides it until you turn on unknown sources once: " +
                    "open Android Auto settings on the phone, tap Version about 10 times to unlock developer mode, " +
                    "then ⋮ › Developer settings › Unknown sources. Reconnect the phone to the car afterwards.",
                15f,
            ),
        )

        col.addView(Button(this).apply {
            text = "Sign out"
            setOnClickListener {
                scope.launch {
                    withContext(Dispatchers.IO) { app.auth.signOut() }
                    CookieManager.getInstance().removeAllCookies(null)
                    WebStorage.getInstance().deleteAllData()
                    showSignIn()
                }
            }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(24) })

        setContentView(ScrollView(this).apply { addView(col) })
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (app.auth.signedIn) showStatus()
    }

    private fun text(s: String, size: Float, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        gravity = Gravity.START
        if (bold) setTypeface(typeface, Typeface.BOLD)
        textAlignment = View.TEXT_ALIGNMENT_VIEW_START
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
