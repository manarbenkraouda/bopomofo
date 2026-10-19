package app.bopomofo.auto.data

import app.bopomofo.auto.net.objects
import app.bopomofo.auto.net.str
import org.json.JSONObject
import kotlin.random.Random

/** A traditional character or word of the Characters exercise (frontend/src/lib/characters.ts). */
data class CharWord(val text: String, val zhuyin: String, val english: String, val french: String?, val fromSentences: Boolean) {
    val source get() = if (fromSentences) "sentence" else "deck"
}

object Characters {
    private const val MAX_LEN = 4
    private val CJK = Regex("^[\\u4e00-\\u9fff]+$")

    /** The words of the learner's sentences with a meaning, 1 to 4 characters, each one once. */
    fun sentenceWords(sentences: List<JSONObject>): List<CharWord> {
        val out = LinkedHashMap<String, CharWord>()
        for (s in sentences) {
            val hanzi = s.optString("hanzi")
            val items = s.optJSONArray("items")?.objects().orEmpty()
            var from = 0
            for (w in s.optJSONArray("words")?.objects().orEmpty()) {
                val text = w.optString("text")
                if (text.isEmpty()) continue
                val at = hanzi.indexOf(text, from)
                if (at < 0) continue
                from = at + text.length
                val english = (w.str("english") ?: "").trim()
                if (english.isEmpty() || !CJK.matches(text) || text.length > MAX_LEN || out.containsKey(text)) continue
                val syls = items.drop(at).take(text.length).filter { it.optString("type") == "syllable" }
                if (syls.size != text.length) continue
                out[text] = CharWord(text, syls.joinToString(" ") { it.optString("zhuyin") }, english, null, fromSentences = true)
            }
        }
        return out.values.toList()
    }

    fun allWords(deck: List<CharWord>, mine: List<CharWord>): List<CharWord> {
        val have = deck.map { it.text }.toSet()
        return deck + mine.filter { it.text !in have }
    }

    fun lookalikesOf(text: String, groups: List<List<String>>) = (groups.firstOrNull { text in it } ?: emptyList()).filter { it != text }

    private fun meaning(w: CharWord) = w.english.trim().lowercase()

    /** 4 choices: the word, its look-alikes, then other words. No two choices share a meaning. */
    fun choices(word: CharWord, words: List<CharWord>, groups: List<List<String>>): List<CharWord> {
        val out = mutableListOf(word)
        val seen = mutableSetOf(meaning(word))
        fun add(w: CharWord?) {
            if (w == null || out.size >= 4 || out.any { it.text == w.text } || meaning(w) in seen) return
            out.add(w)
            seen.add(meaning(w))
        }
        val byText = words.associateBy { it.text }
        for (t in lookalikesOf(word.text, groups).shuffled()) add(byText[t])
        val others = words.filter { it.text != word.text }.shuffled()
        for (w in others) if (w.text.length == word.text.length) add(w)
        for (w in others) add(w)
        return out.shuffled()
    }

    /** The next word: about 30% from the learner's sentences. */
    fun pick(words: List<CharWord>, last: String?): CharWord? {
        val pool = words.filter { it.text != last }
        if (pool.isEmpty()) return words.firstOrNull()
        val mine = pool.filter { it.fromSentences }
        val deck = pool.filter { !it.fromSentences }
        val from = if (mine.isNotEmpty() && (deck.isEmpty() || Random.nextDouble() < 0.3)) mine else deck
        return from.random()
    }
}
