package app.bopomofo.auto.data

/** Bopomofo helpers, the same rules as frontend/src/lib/zhuyin.ts, quiz.ts, and track.ts. */
object Zhuyin {
    val TONE_MARKS = listOf("ˊ", "ˇ", "ˋ", "˙")
    val TONE_MARK = mapOf(1 to "", 2 to "ˊ", 3 to "ˇ", 4 to "ˋ", 5 to "˙")
    val TONE_NAME = mapOf(1 to "High, flat", 2 to "Rising", 3 to "Low, dipping", 4 to "Falling")
    private val INITIALS = "ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ".map { it.toString() }

    data class Split(val symbols: List<String>, val tone: Int)

    fun split(z: String): Split {
        val chars = z.map { it.toString() }
        val mark = chars.firstOrNull { it in TONE_MARKS } ?: ""
        val tone = when (mark) { "" -> 1; "ˊ" -> 2; "ˇ" -> 3; "ˋ" -> 4; else -> 5 }
        return Split(chars.filter { it !in TONE_MARKS && it.isNotBlank() }, tone)
    }

    data class Parts(val initial: String, val final: String, val tone: Int, val base: String)

    /** Initial, final (with the medial), and tone, named as the backend names them. ∅ = none. */
    fun parts(z: String): Parts {
        val (symbols, tone) = split(z)
        val initial = symbols.firstOrNull()?.takeIf { it in INITIALS } ?: ""
        val final = symbols.drop(if (initial.isNotEmpty()) 1 else 0).joinToString("")
        return Parts(initial.ifEmpty { "∅" }, final.ifEmpty { "∅" }, tone, symbols.joinToString(""))
    }

    fun withTone(z: String, t: Int) = split(z).symbols.joinToString("") + TONE_MARK.getValue(t)

    /** How each symbol is said on its own (lib/quiz.ts SYMBOL_NAME). */
    fun nameOf(s: String): String = when (s) {
        in listOf("ㄅ", "ㄆ", "ㄇ", "ㄈ") -> s + "ㄛ"
        in listOf("ㄉ", "ㄊ", "ㄋ", "ㄌ", "ㄍ", "ㄎ", "ㄏ") -> s + "ㄜ"
        in listOf("ㄐ", "ㄑ", "ㄒ") -> s + "ㄧ"
        else -> s
    }

    val PINYIN_OF = mapOf(
        "ㄅ" to "b", "ㄆ" to "p", "ㄇ" to "m", "ㄈ" to "f", "ㄉ" to "d", "ㄊ" to "t", "ㄋ" to "n", "ㄌ" to "l",
        "ㄍ" to "g", "ㄎ" to "k", "ㄏ" to "h", "ㄐ" to "j", "ㄑ" to "q", "ㄒ" to "x", "ㄓ" to "zh", "ㄔ" to "ch",
        "ㄕ" to "sh", "ㄖ" to "r", "ㄗ" to "z", "ㄘ" to "c", "ㄙ" to "s", "ㄚ" to "a", "ㄛ" to "o", "ㄜ" to "e",
        "ㄝ" to "ê", "ㄞ" to "ai", "ㄟ" to "ei", "ㄠ" to "ao", "ㄡ" to "ou", "ㄢ" to "an", "ㄣ" to "en", "ㄤ" to "ang",
        "ㄥ" to "eng", "ㄦ" to "er", "ㄧ" to "i / y", "ㄨ" to "u / w", "ㄩ" to "ü / yu",
    )
}
