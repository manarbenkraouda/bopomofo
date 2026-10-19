package app.bopomofo.auto.data

import java.text.NumberFormat
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.random.Random

/** Numbers in Taiwan Mandarin. The same rules as frontend/src/lib/numbers.ts and backend/app/numbers.py. */
object Numbers {
    const val MAX = 99_999_999L
    private const val DIGITS = "零一二三四五六七八九"
    val BANDS = listOf("0-10", "11-99", "100-999", "1000-9999", "10000+")
    private val WEIGHT = mapOf("0-10" to 1, "11-99" to 2, "100-999" to 2, "1000-9999" to 2, "10000+" to 2)

    private fun small(n: Long, first: Boolean): String {
        val out = StringBuilder()
        var zero = false
        for ((value, unit) in listOf(1000L to "千", 100L to "百", 10L to "十", 1L to "")) {
            val d = ((n / value) % 10).toInt()
            if (d == 0) {
                zero = zero || out.isNotEmpty()
                continue
            }
            if (zero) {
                out.append("零")
                zero = false
            }
            if (value == 10L && d == 1 && out.isEmpty() && first) {
                out.append("十")
                continue
            }
            out.append(if (d == 2 && value >= 100) "兩" else DIGITS[d].toString()).append(unit)
        }
        return out.toString()
    }

    /** The characters said for a number: 15 -> 十五, 205 -> 兩百零五, 20000 -> 兩萬. */
    fun hanzi(n: Long): String {
        require(n in 0..MAX)
        if (n == 0L) return "零"
        val hi = n / 10000
        val lo = n % 10000
        if (hi == 0L) return small(lo, true)
        val out = StringBuilder(if (hi == 2L) "兩" else small(hi, true)).append("萬")
        if (lo > 0) out.append(if (lo < 1000) "零" else "").append(small(lo, false))
        return out.toString()
    }

    fun band(n: Long) = when {
        n <= 10 -> "0-10"
        n <= 99 -> "11-99"
        n <= 999 -> "100-999"
        n <= 9999 -> "1000-9999"
        else -> "10000+"
    }

    /** The kind of a listening error, or null when the answer is right. */
    fun errorOf(expected: Long, picked: Long): String? {
        if (expected == picked) return null
        val e = expected.toString()
        val p = picked.toString()
        val lo = min(expected, picked)
        val hi = max(expected, picked)
        if (lo in 11..19 && hi == (lo - 10) * 10) return "teens"
        if (e.length == p.length && e.toList().sorted() == p.toList().sorted()) return "order"
        if (e.replace("0", "") == p.replace("0", "")) return "place"
        if (e.length == p.length && e.indices.count { e[it] != p[it] } == 1) return "digit"
        if (lo == 4L && hi == 10L) return "4-10"
        return "other"
    }

    fun digits(n: Long): String = NumberFormat.getIntegerInstance(Locale.US).format(n)

    private fun rnd(lo: Long, hi: Long) = Random.nextLong(lo, hi + 1)

    private fun withZeros(n: Long): Long {
        val s = n.toString().toCharArray()
        if (s.size < 3 || Random.nextDouble() > 0.25) return n
        s[Random.nextInt(1, s.size - 1)] = '0'
        return String(s).toLong()
    }

    fun randomIn(b: String): Long = when (b) {
        "0-10" -> rnd(0, 10)
        "11-99" -> rnd(11, 99)
        "100-999" -> withZeros(rnd(100, 999))
        "1000-9999" -> withZeros(rnd(1000, 9999))
        else -> {
            val len = Random.nextInt(5, 9)
            var lo = 1L
            repeat(len - 1) { lo *= 10 }
            withZeros(rnd(lo, lo * 10 - 1))
        }
    }

    fun randomBand(): String {
        var r = Random.nextDouble() * BANDS.sumOf { WEIGHT.getValue(it) }
        for (b in BANDS) {
            r -= WEIGHT.getValue(b)
            if (r < 0) return b
        }
        return BANDS.last()
    }

    private fun nearMisses(n: Long): List<Long> {
        val out = mutableListOf<Long>()
        val s = n.toString()
        if (n in 11..19) out.add((n - 10) * 10)
        if (n in 20..90 && n % 10 == 0L) out.add(n / 10 + 10)
        for (i in 0 until s.length - 1) {
            if (s[i] == s[i + 1] || (i == 0 && s[1] == '0')) continue
            out.add((s.substring(0, i) + s[i + 1] + s[i] + s.substring(i + 2)).toLong())
        }
        out.add(n * 10)
        if (n % 10 == 0L) out.add(n / 10)
        val zero = s.indexOf('0', 1)
        if (zero > 0) out.add((s.substring(0, zero) + s.substring(zero + 1) + "0").toLong())
        for (i in s.indices.reversed()) {
            val d = s[i] - '0'
            for (nd in listOf(d + 1, d - 1)) {
                if (nd < 0 || nd > 9 || (i == 0 && nd == 0 && s.length > 1)) continue
                out.add((s.substring(0, i) + nd + s.substring(i + 1)).toLong())
            }
        }
        if (n == 4L) out.add(10)
        if (n == 10L) out.add(4)
        return out.distinct().filter { it in 0..MAX && it != n }
    }

    /** Four unique choices with the answer: the closest near misses first, then random numbers of the same band. */
    fun choices(n: Long): List<Long> {
        val near = nearMisses(n)
        val strongN = max(0, near.size - 2 * n.toString().length)
        val strong = near.take(strongN).shuffled()
        val weak = near.drop(strongN).shuffled()
        val picked = linkedSetOf(n)
        for (x in strong.take(2) + weak + strong.drop(2)) {
            if (picked.size >= 4) break
            picked.add(x)
        }
        var guard = 0
        while (picked.size < 4 && guard++ < 100) picked.add(randomIn(band(n)))
        return picked.toList().shuffled()
    }
}
