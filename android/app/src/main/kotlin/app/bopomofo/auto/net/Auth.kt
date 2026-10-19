package app.bopomofo.auto.net

import android.content.Context
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

class SignedOut : Exception("Open Bopomofo on your phone and sign in.")

private class SessionGone : IOException("The session ended.")

/**
 * Clerk sign-in without the Clerk SDK.
 *
 * The phone signs in on the real bopomofo.app sign-in page (a WebView). Clerk then keeps the browser client in the
 * __client cookie of clerk.bopomofo.app. This class keeps that cookie and asks Clerk's Frontend API for a fresh
 * 60-second session token whenever the API needs one, the same request clerk-js makes in the browser.
 */
class Auth(context: Context, private val http: OkHttpClient) {
    private val prefs = context.getSharedPreferences("auth", Context.MODE_PRIVATE)
    private val lock = Mutex()

    @Volatile private var jwt: String? = null
    @Volatile private var jwtExp = 0L

    val signedIn: Boolean get() = prefs.getString(KEY_CLIENT, null) != null && prefs.getString(KEY_SESSION, null) != null
    val name: String get() = prefs.getString(KEY_NAME, null).orEmpty()

    data class Client(val cookie: String, val session: String?, val name: String)

    /** The Clerk client of a __client cookie: its active session, if any. Blocking. */
    fun inspect(cookie: String): Client {
        val (json, fresh) = try {
            request("GET", "/client", cookie)
        } catch (e: SessionGone) {
            return Client(cookie, null, "")
        }
        val resp = json.optJSONObject("response") ?: return Client(fresh ?: cookie, null, "")
        val last = resp.str("last_active_session_id")
        var sid: String? = null
        var name = ""
        for (s in resp.optJSONArray("sessions")?.objects().orEmpty()) {
            if (s.str("status") != "active") continue
            val id = s.str("id") ?: continue
            if (sid == null || id == last) {
                sid = id
                val u = s.optJSONObject("user")
                name = u?.str("first_name") ?: u?.optJSONArray("email_addresses")?.optJSONObject(0)?.str("email_address") ?: ""
            }
        }
        return Client(fresh ?: cookie, sid, name)
    }

    fun adopt(c: Client) {
        prefs.edit().putString(KEY_CLIENT, c.cookie).putString(KEY_SESSION, c.session).putString(KEY_NAME, c.name).apply()
        jwt = null
    }

    /** Forget the sign-in here, and end the Clerk session (best effort). Blocking. */
    fun signOut() {
        val cookie = prefs.getString(KEY_CLIENT, null)
        val sid = prefs.getString(KEY_SESSION, null)
        prefs.edit().clear().apply()
        jwt = null
        if (cookie != null && sid != null) runCatching { request("POST", "/client/sessions/$sid/end", cookie) }
    }

    fun invalidateToken() {
        jwt = null
    }

    /** A session token for api.bopomofo.app, fresh for at least 15 seconds. */
    suspend fun token(): String = lock.withLock {
        withContext(Dispatchers.IO) {
            val cached = jwt
            if (cached != null && System.currentTimeMillis() < jwtExp - 15_000) return@withContext cached
            val cookie = prefs.getString(KEY_CLIENT, null) ?: throw SignedOut()
            val sid = prefs.getString(KEY_SESSION, null) ?: throw SignedOut()
            try {
                mint(cookie, sid)
            } catch (e: SessionGone) {
                // The session may have been replaced (single-session mode): look for the current one.
                val c = inspect(cookie)
                if (c.session == null) {
                    prefs.edit().remove(KEY_SESSION).apply()
                    throw SignedOut()
                }
                adopt(c)
                try {
                    mint(c.cookie, c.session)
                } catch (e2: SessionGone) {
                    prefs.edit().remove(KEY_SESSION).apply()
                    throw SignedOut()
                }
            }
        }
    }

    private fun mint(cookie: String, sid: String): String {
        val (json, fresh) = request("POST", "/client/sessions/$sid/tokens", cookie)
        if (fresh != null) prefs.edit().putString(KEY_CLIENT, fresh).apply()
        val token = json.str("jwt") ?: throw SessionGone()
        jwt = token
        jwtExp = expiryOf(token)
        return token
    }

    private fun request(method: String, path: String, cookie: String): Pair<JSONObject, String?> {
        val body = if (method == "POST") ByteArray(0).toRequestBody(FORM) else null
        val req = Request.Builder()
            .url(FAPI + path)
            .method(method, body)
            .header("Origin", ORIGIN)
            .header("Referer", "$ORIGIN/")
            .header("User-Agent", USER_AGENT)
            .header("Cookie", "__client=$cookie")
            .build()
        http.newCall(req).execute().use { r ->
            val fresh = r.headers("Set-Cookie").firstNotNullOfOrNull { c ->
                if (c.startsWith("__client=")) c.substringAfter('=').substringBefore(';').takeIf { it.isNotEmpty() } else null
            }
            val text = r.body?.string().orEmpty()
            if (r.code == 401 || r.code == 404 || r.code == 422) throw SessionGone()
            if (!r.isSuccessful) throw IOException("The sign-in service answered " + r.code + ".")
            return JSONObject(text) to fresh
        }
    }

    private fun expiryOf(token: String): Long = runCatching {
        val payload = token.split('.')[1]
        val json = JSONObject(String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)))
        json.getLong("exp") * 1000
    }.getOrElse { System.currentTimeMillis() + 30_000 }

    companion object {
        const val FAPI = "https://clerk.bopomofo.app/v1"
        const val ORIGIN = "https://bopomofo.app"
        const val SIGN_IN_URL = "https://bopomofo.app/sign-in"
        const val CLERK_URL = "https://clerk.bopomofo.app"
        private const val USER_AGENT =
            "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 BopomofoAuto/0.1"
        private val FORM = "application/x-www-form-urlencoded".toMediaType()
        private const val KEY_CLIENT = "client"
        private const val KEY_SESSION = "session"
        private const val KEY_NAME = "name"
    }
}
