package app.bopomofo.auto.data

import android.content.Context
import app.bopomofo.auto.net.objects
import app.bopomofo.auto.net.str
import org.json.JSONArray
import org.json.JSONObject

/** One of the 37 symbols, with its MOE recording. */
data class MoeRow(val sym: String, val audio: String) {
    val audioAsset get() = "audio/symbols/F" + audio.drop(1) + ".wav"
}

/** A syllable with its MOE recording. */
data class Syllable(val id: String, val char: String, val zhuyin: String) {
    val audioAsset get() = "audio/syllables/$id.mp3"
}

/** The exercise data bundled from frontend/public (copied at build time). */
class Content(context: Context) {
    private val assets = context.assets

    private fun read(path: String) = assets.open(path).bufferedReader().use { it.readText() }

    val table: List<MoeRow> by lazy {
        JSONArray(read("data/moe-table.json")).objects().map { MoeRow(it.getString("sym"), it.getString("audio")) }
    }

    val syllables: List<Syllable> by lazy {
        JSONArray(read("data/syllables.json")).objects().map { Syllable(it.getString("id"), it.getString("char"), it.getString("zhuyin")) }
    }

    private val chars: JSONObject by lazy { JSONObject(read("data/characters.json")) }

    val charDeck: List<CharWord> by lazy {
        chars.optJSONArray("words")?.objects().orEmpty().map {
            CharWord(it.getString("text"), it.optString("zhuyin"), it.optString("english"), it.str("french"), fromSentences = false)
        }
    }

    val lookalikes: List<List<String>> by lazy {
        val groups = chars.optJSONArray("lookalikes") ?: JSONArray()
        (0 until groups.length()).map { i ->
            val g = groups.getJSONArray(i)
            (0 until g.length()).map { g.getString(it) }
        }
    }
}
