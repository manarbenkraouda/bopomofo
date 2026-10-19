package app.bopomofo.auto.car

import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.CarIcon
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import app.bopomofo.auto.BopomofoApp
import app.bopomofo.auto.audio.Focus
import app.bopomofo.auto.audio.Heard
import app.bopomofo.auto.audio.Listener
import app.bopomofo.auto.audio.Mic
import app.bopomofo.auto.audio.Player
import app.bopomofo.auto.audio.Sfx
import app.bopomofo.auto.data.MoeRow
import app.bopomofo.auto.data.Numbers
import app.bopomofo.auto.data.Zhuyin
import app.bopomofo.auto.net.ApiError
import app.bopomofo.auto.net.SignedOut
import app.bopomofo.auto.net.jsonOf
import app.bopomofo.auto.net.objects
import app.bopomofo.auto.net.str
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

enum class SpeakKind(val title: String, val about: String, val maxS: Double, val endS: Double) {
    SYMBOLS("Say the symbol", "See a symbol, say its name", 4.0, 0.45),
    SYLLABLES("Repeat syllables", "Hear a syllable, say it back", 4.0, 0.6),
    SENTENCES("Repeat sentences", "Your saved sentences, said back", 12.0, 0.9),
    NUMBERS("Say the number", "See a number, say it in Mandarin", 8.0, 0.7),
}

/**
 * Hands-free practice: the card shows, the app listens, checks what it heard on the server, and moves on by
 * itself when the answer is right. Reading (symbols) uses /api/symbols/check and saves the answer like the web
 * Reading page; the other kinds use /api/speech/analyze, which saves every recording on the server.
 */
class SpeakScreen(ctx: CarContext, private val kind: SpeakKind) : Screen(ctx) {
    private val app = BopomofoApp.of(ctx)
    private val player = Player(ctx)
    private val focus = Focus(ctx)
    private val listener = Listener { Mic.open(carContext) }
    private var job: Job? = null
    private val main = android.os.Handler(android.os.Looper.getMainLooper())

    private class Card(
        val key: String,
        val glyph: String,
        val line: String,
        val answer: String,
        val text: String = "",
        val number: Long? = null,
        val asset: String? = null,
    )

    private var card: Card? = null
    private var icon: CarIcon? = null
    private var status = "Getting ready…"
    private var detail = ""
    private var paused = false

    // The current card: misses, help, and (Reading) every try, as the web app saves them.
    private var tries = 0
    private var helped = false
    private var shownAt = 0L
    private var firstMs: Long? = null
    private var units = JSONArray()

    private var cards = 0
    private var good = 0
    private var symbols: List<MoeRow>? = null
    private var sentences: List<JSONObject>? = null
    private var last: String? = null

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = begin()
            override fun onStop(owner: LifecycleOwner) = halt()
        })
    }

    private fun begin() {
        if (carContext.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            show("Allow the microphone", "Check your phone screen.")
            carContext.requestPermissions(listOf(Manifest.permission.RECORD_AUDIO)) { granted, _ ->
                if (granted.isNotEmpty()) begin() else show("The microphone is off", "Open Bopomofo on your phone to allow it.")
            }
            return
        }
        focus.take()
        restart { session(fresh = card == null, promptFirst = card == null) }
    }

    private fun halt() {
        job?.cancel()
        job = null
        player.stop()
        focus.release()
    }

    /** Stops what runs now (listening or playing), then runs block. */
    private fun restart(block: suspend () -> Unit) {
        val old = job
        player.stop()
        job = lifecycleScope.launch {
            old?.cancelAndJoin()
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: SignedOut) {
                show("Sign in on your phone", e.message ?: "")
            } catch (e: Exception) {
                show("Something went wrong", e.message ?: "Try again in a moment.")
            }
        }
    }

    private fun show(s: String, d: String = detail) {
        status = s
        detail = d
        invalidate()
    }

    private suspend fun session(fresh: Boolean, promptFirst: Boolean) {
        paused = false
        if (fresh) newCard() ?: return
        if (promptFirst && app.playFirst && (kind == SpeakKind.SYLLABLES || kind == SpeakKind.SENTENCES)) hear()
        while (true) {
            if (attempt()) {
                delay(1400)
                newCard() ?: return
                if (app.playFirst && (kind == SpeakKind.SYLLABLES || kind == SpeakKind.SENTENCES)) hear()
            }
        }
    }

    /** One recording. True when the card is finished (right, or given up). */
    private suspend fun attempt(): Boolean {
        val c = card ?: return false
        show(if (tries == 0) "Speak now" else "Try again: speak now", detail)
        Sfx.listen()
        val heard = listener.listen(waitMs = 20_000, maxS = kind.maxS, endS = kind.endS) {
            // Called on the microphone thread: templates are only touched on the main thread.
            main.post { show("Too quiet: speak a little louder", detail) }
        }
        if (heard !is Heard.Speech) {
            paused = true
            show("Paused", "Tap Listen when you are ready.")
            awaitCancellation()
        }
        show("Checking…", detail)
        return try {
            if (kind == SpeakKind.SYMBOLS) checkSymbol(c, heard.wav) else checkSpeech(c, heard.wav)
        } catch (e: ApiError) {
            show(e.message ?: "Something went wrong", "")
            delay(2500)
            false
        }
    }

    private suspend fun checkSymbol(c: Card, wav: ByteArray): Boolean {
        val r = app.api.checkSymbol(wav, c.key)
        val ok = r.optBoolean("ok")
        val heardSym = r.str("heard") ?: r.str("closest") ?: "?"
        firstMs = firstMs ?: (SystemClock.elapsedRealtime() - shownAt)
        val top = r.optJSONArray("ranking")?.let { a -> JSONArray((0 until minOf(3, a.length())).map { a.optString(it) }) }
        units.put(
            jsonOf(
                "kind" to "symbol", "expected" to c.key, "actual" to heardSym, "ok" to ok, "try_n" to units.length(),
                "help" to helped, "uncertain" to r.isNull("heard"),
                "extra" to jsonOf("fit" to (r.optDouble("fit", 0.0) * 100).roundToInt() / 100.0, "lenient" to r.optBoolean("lenient").takeIf { it }, "top" to top),
            ),
        )
        if (ok) {
            Sfx.right()
            show("Right!", c.answer)
            finishSymbol(true)
            return true
        }
        tries += 1
        Sfx.wrong()
        show("Heard $heardSym", if (helped) c.answer else "Try again.")
        if (tries >= 3 && !helped) {
            delay(500)
            hear()
        }
        if (tries >= 6) {
            finishSymbol(false)
            show("Let's move on", c.answer)
            return true
        }
        return false
    }

    /** Saves a Reading card like ReadingQuiz.finishCard: right on the first try without help, every try as a unit. */
    private fun finishSymbol(ok: Boolean) {
        val c = card ?: return
        val firstTry = ok && !helped && tries == 0
        val u = if (units.length() > 0) units else JSONArray().put(jsonOf("kind" to "symbol", "expected" to c.key, "actual" to JSONObject.NULL, "ok" to false, "help" to helped))
        val ev = jsonOf(
            "area" to "reading", "item" to c.key, "ok" to firstTry, "first_try" to firstTry, "ms" to firstMs,
            "tries" to tries + if (ok) 1 else 0, "help" to helped, "units" to u,
            "details" to jsonOf("skipped" to !ok, "set" to "all", "client" to "android-auto"),
        )
        cards += 1
        if (firstTry) good += 1
        units = JSONArray()
        app.scope.launch { app.api.event(ev) }
    }

    private suspend fun checkSpeech(c: Card, wav: ByteArray): Boolean {
        val mode = when (kind) {
            SpeakKind.SYLLABLES -> "syllable"
            SpeakKind.SENTENCES -> "sentence"
            else -> "numbers"
        }
        val r = app.api.speech(wav, c.text, mode, help = helped, tryN = tries, number = c.number)
        val score = r.optDouble("score", 0.0).roundToInt()
        val ok = score >= PASS
        if (tries == 0) {
            cards += 1
            if (ok && !helped) good += 1
        }
        tries += 1
        val verdict = when {
            score >= 85 -> "Excellent! $score"
            score >= 60 -> "Almost: $score"
            else -> "Keep practicing: $score"
        }
        val misses = r.optJSONArray("syllables")?.objects().orEmpty().filter {
            !it.optBoolean("tone_ok") || (!it.isNull("initial_ok") && !it.optBoolean("initial_ok")) || (!it.isNull("final_ok") && !it.optBoolean("final_ok"))
        }
        val notes = misses.take(3).joinToString("  ") { s ->
            val e = s.optJSONObject("expected")
            val h = s.optJSONObject("heard")?.str("zhuyin") ?: "—"
            (e?.str("char") ?: "") + " " + h + " → " + (e?.str("zhuyin") ?: "")
        }
        if (ok) {
            Sfx.right()
            show(verdict, if (notes.isNotEmpty()) notes else c.answer)
            return true
        }
        Sfx.wrong()
        show(verdict, notes.ifEmpty { c.answer })
        if (tries >= 3) {
            delay(1800)
            show("Let's move on", c.answer)
            return true
        }
        delay(1500)
        if (app.playFirst && kind != SpeakKind.NUMBERS) hear()
        return false
    }

    /** Plays the answer or the model. It counts as help for this card, like Hear the answer and Cheat on the web. */
    private suspend fun hear() {
        val c = card ?: return
        helped = true
        show("Listen…", c.answer)
        when {
            c.asset != null -> player.asset(c.asset)
            c.text.isNotEmpty() -> player.file(app.api.tts(c.text))
        }
    }

    private suspend fun newCard(): Card? {
        val c = when (kind) {
            SpeakKind.SYMBOLS -> {
                val pool = symbols ?: loadSymbols().also { symbols = it }
                val row = pool.filter { it.sym != last }.ifEmpty { pool }.random()
                Card(row.sym, row.sym, "Say this symbol", Zhuyin.nameOf(row.sym) + " · " + Zhuyin.PINYIN_OF[row.sym], asset = row.audioAsset)
            }
            SpeakKind.SYLLABLES -> {
                val s = app.content.syllables.filter { it.char != last }.random()
                Card(s.char, s.char + "\n" + s.zhuyin, s.zhuyin, s.char + " " + s.zhuyin, text = s.char, asset = s.audioAsset)
            }
            SpeakKind.SENTENCES -> {
                val all = sentences ?: app.api.sentences().also { sentences = it }
                if (all.isEmpty()) {
                    show("No sentences yet", "Make some on bopomofo.app, then come back.")
                    return null
                }
                val s = all.filter { it.optString("hanzi") != last }.ifEmpty { all }.random()
                val hanzi = s.optString("hanzi")
                Card(hanzi, hanzi, s.optString("english"), s.optString("english"), text = hanzi)
            }
            SpeakKind.NUMBERS -> {
                val n = Numbers.randomIn(Numbers.randomBand())
                Card(n.toString(), Numbers.digits(n), "Say it in Mandarin", Numbers.hanzi(n), text = Numbers.hanzi(n), number = n)
            }
        }
        card = c
        last = c.key
        icon = when (kind) {
            SpeakKind.SENTENCES -> Glyph.text(carContext, c.glyph, size = 110f, maxChars = 10, square = false)
            SpeakKind.NUMBERS -> Glyph.text(carContext, c.glyph, size = 160f, maxChars = 12, square = false)
            else -> Glyph.text(carContext, c.glyph, size = 220f)
        }
        tries = 0
        helped = false
        firstMs = null
        units = JSONArray()
        shownAt = SystemClock.elapsedRealtime()
        detail = ""
        return c
    }

    /** The symbols to say: the ones the learner knows or is learning, and the next group. All 37 when few are known. */
    private suspend fun loadSymbols(): List<MoeRow> {
        val table = app.content.table
        val a = runCatching { app.api.alphabet() }.getOrNull() ?: return table
        val want = mutableSetOf<String>()
        for (s in a.optJSONArray("symbols")?.objects().orEmpty()) if (s.optString("state") != "new") want.add(s.optString("sym"))
        a.optJSONArray("next_group")?.let { g -> for (i in 0 until g.length()) want.add(g.optString(i)) }
        val pool = table.filter { it.sym in want }
        return if (pool.size >= 4) pool else table
    }

    private fun skip() {
        if (kind == SpeakKind.SYMBOLS && card != null) finishSymbol(false)
        restart { session(fresh = true, promptFirst = true) }
    }

    override fun onGetTemplate(): Template {
        val pane = Pane.Builder()
        icon?.let { pane.setImage(it) }
        val first = Row.Builder().setTitle(status)
        if (detail.isNotEmpty()) first.addText(detail)
        pane.addRow(first.build())
        val score = if (cards > 0) "$good of $cards right the first time" else "Answers go to your stats"
        pane.addRow(Row.Builder().setTitle(card?.line?.ifEmpty { null } ?: kind.about).addText(score).build())
        pane.addAction(
            Action.Builder()
                .setTitle(if (paused) "Listen" else "Hear it")
                .setFlags(Action.FLAG_PRIMARY)
                .setOnClickListener {
                    if (paused) {
                        restart { session(fresh = false, promptFirst = false) }
                    } else {
                        restart {
                            hear()
                            session(fresh = false, promptFirst = false)
                        }
                    }
                }
                .build(),
        )
        pane.addAction(Action.Builder().setTitle("Next").setOnClickListener { skip() }.build())
        return PaneTemplate.Builder(pane.build())
            .setTitle(kind.title)
            .setHeaderAction(Action.BACK)
            .build()
    }

    companion object {
        /** The score of a right recording, as the backend saves it (stats.log_speaking). */
        private const val PASS = 80
    }
}
