package app.bopomofo.auto

import android.app.Application
import android.content.Context
import app.bopomofo.auto.data.Content
import app.bopomofo.auto.net.Api
import app.bopomofo.auto.net.Auth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit

/** The shared objects of the phone screen and the car screens: sign-in, API client, exercise data, settings. */
class BopomofoApp : Application() {
    lateinit var auth: Auth
        private set
    lateinit var api: Api
        private set
    val content by lazy { Content(this) }

    /** For work that must finish even when a car screen closes, like saving an answer. */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        val http = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .callTimeout(90, TimeUnit.SECONDS)
            .build()
        auth = Auth(this, http)
        api = Api(auth, http, File(cacheDir, "tts"))
    }

    private val settings get() = getSharedPreferences("settings", MODE_PRIVATE)

    /** Repeat modes: play the model before the learner speaks. Answers after it count as helped, like the Cheat button. */
    var playFirst: Boolean
        get() = settings.getBoolean("play_first", true)
        set(v) = settings.edit().putBoolean("play_first", v).apply()

    companion object {
        fun of(c: Context) = c.applicationContext as BopomofoApp
    }
}
