package app.bopomofo.auto.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.MessageDigest

class ApiError(message: String) : Exception(message)

/** The bopomofo.app API, with the same routes and fields as the web app (frontend/src/lib/api.ts). */
class Api(private val auth: Auth, private val http: OkHttpClient, private val ttsDir: File) {

    suspend fun me(): JSONObject = json { get("/api/me") }

    suspend fun alphabet(): JSONObject = json { get("/api/alphabet") }

    suspend fun sentences(): List<JSONObject> = json { get("/api/sentences") }.optJSONArray("sentences")?.objects().orEmpty()

    /** The open number sizes of a mode ("listen" or "speak"), smallest first, from the level path (levels.number_bands).
     *  null when the server does not send them (an older server): then every size is open, like the web app. */
    suspend fun numberBands(mode: String): List<String>? =
        json { get("/api/levels") }.optJSONObject("numbers")?.optJSONArray(mode)?.objects()
            ?.filter { it.optBoolean("open") }?.map { it.optString("band") }?.ifEmpty { null }

    /** Reading: did the learner say the name of this symbol? */
    suspend fun checkSymbol(wav: ByteArray, symbol: String): JSONObject = json {
        post(
            "/api/symbols/check",
            MultipartBody.Builder().setType(MultipartBody.FORM)
                .addFormDataPart("audio", "symbol.wav", wav.toRequestBody(WAV))
                .addFormDataPart("symbol", symbol)
                .build(),
        )
    }

    /** Speaking: score a recording of a text. The server saves the answer. number: a spoken number (Numbers). */
    suspend fun speech(wav: ByteArray, text: String, mode: String, help: Boolean, tryN: Int, number: Long? = null): JSONObject = json {
        val b = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("audio", "speech.wav", wav.toRequestBody(WAV))
            .addFormDataPart("text", text)
            .addFormDataPart("mode", mode)
        if (help) b.addFormDataPart("help", "1")
        if (tryN > 0) b.addFormDataPart("try_n", tryN.toString())
        if (number != null) b.addFormDataPart("number", number.toString())
        post("/api/speech/analyze", b.build())
    }

    /** Save one graded answer. Errors are dropped, like the web app: practice goes on. */
    suspend fun event(ev: JSONObject) {
        runCatching { json { post("/api/progress/event", ev.toString().toRequestBody(JSON)) } }
    }

    /** The audio of a text (a WAV file), kept in the cache so a replay is instant. */
    suspend fun tts(text: String, rate: Int = 0): File = withContext(Dispatchers.IO) {
        ttsDir.mkdirs()
        val key = MessageDigest.getInstance("SHA-1").digest("$rate|$text".toByteArray()).joinToString("") { "%02x".format(it) }
        val file = File(ttsDir, "$key.wav")
        if (file.length() > 0) return@withContext file
        val url = (BASE + "/api/tts").toHttpUrl().newBuilder()
            .addQueryParameter("text", text)
            .addQueryParameter("rate", rate.toString())
            .build()
        execute { Request.Builder().url(url) }.use { r ->
            val tmp = File(ttsDir, "$key.part")
            tmp.outputStream().use { out -> r.body!!.byteStream().copyTo(out) }
            if (!tmp.renameTo(file)) throw ApiError("Could not save the audio.")
        }
        file
    }

    private fun get(path: String) = Request.Builder().url(BASE + path)

    private fun post(path: String, body: okhttp3.RequestBody) = Request.Builder().url(BASE + path).post(body)

    private suspend fun json(build: () -> Request.Builder): JSONObject = withContext(Dispatchers.IO) {
        execute(build).use { JSONObject(it.body!!.string()) }
    }

    private suspend fun execute(build: () -> Request.Builder): Response = withContext(Dispatchers.IO) {
        for (attempt in 0..1) {
            val token = auth.token()
            val r = try {
                http.newCall(build().header("Authorization", "Bearer $token").build()).execute()
            } catch (e: IOException) {
                throw ApiError("Can't connect right now.")
            }
            if (r.code == 401 && attempt == 0) {
                r.close()
                auth.invalidateToken()
                continue
            }
            if (!r.isSuccessful) {
                val msg = r.use { errorMessage(it) }
                throw ApiError(msg)
            }
            return@withContext r
        }
        throw ApiError("Please sign in again on your phone.")
    }

    private fun errorMessage(r: Response): String {
        val detail = runCatching { JSONObject(r.body!!.string()).str("detail") }.getOrNull().orEmpty()
        return when {
            r.code == 401 -> "Please sign in again on your phone."
            r.code == 503 -> "The speech check is getting ready. Try again in a few seconds."
            r.code == 429 && detail.isNotEmpty() -> detail
            r.code == 400 && detail.isNotEmpty() && detail.length < 120 -> detail
            else -> "Something went wrong (" + r.code + "). Try again in a moment."
        }
    }

    companion object {
        const val BASE = "https://api.bopomofo.app"
        private val WAV = "audio/wav".toMediaType()
        private val JSON = "application/json".toMediaType()
    }
}
