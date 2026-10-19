package app.bopomofo.auto.car

import android.os.SystemClock
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.model.Action
import androidx.car.app.model.ActionStrip
import androidx.car.app.model.CarIcon
import androidx.car.app.model.GridItem
import androidx.car.app.model.GridTemplate
import androidx.car.app.model.ItemList
import androidx.car.app.model.ListTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import app.bopomofo.auto.BopomofoApp
import app.bopomofo.auto.audio.Focus
import app.bopomofo.auto.audio.Player
import app.bopomofo.auto.audio.Sfx
import app.bopomofo.auto.data.CharWord
import app.bopomofo.auto.data.Characters
import app.bopomofo.auto.data.Numbers
import app.bopomofo.auto.data.Syllable
import app.bopomofo.auto.data.Zhuyin
import app.bopomofo.auto.net.SignedOut
import app.bopomofo.auto.net.jsonOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

enum class ChoiceKind(val menu: String, val title: String, val about: String) {
    TONE("Which tone?", "Which tone?", "Hear a syllable, tap its tone"),
    ZHUYIN("Which Bopomofo?", "Which Bopomofo?", "Hear a syllable, tap its spelling"),
    CHARACTERS("Characters", "What does it mean?", "See a traditional character, tap its meaning"),
    NUMBERS("Hear numbers", "Which number?", "Hear a number, tap it"),
}

/**
 * Tap-the-answer quizzes: the Listening tone and Bopomofo quizzes, Characters, and Numbers (listen). Each answer is
 * saved with the same fields as the web app. The title and the number of items never change while a quiz runs, so
 * Android Auto treats each new question as a refresh of the same screen.
 */
class ChoiceScreen(ctx: CarContext, private val kind: ChoiceKind) : Screen(ctx) {
    private val app = BopomofoApp.of(ctx)
    private val player = Player(ctx)
    private val focus = Focus(ctx)
    private var job: Job? = null

    private class Option(val key: String, val label: String, val icon: CarIcon?, val after: String = "")

    private class Question(
        val item: String,
        val options: List<Option>,
        val answer: Int,
        val syllable: Syllable? = null,
        val word: CharWord? = null,
        val number: Long? = null,
    )

    private var q: Question? = null
    private var picked = -1
    private var shownAt = 0L
    private var replays = 0
    private var hinted = false
    private var error = ""
    private var last: String? = null
    private var words: List<CharWord>? = null
    private val toneIcons = HashMap<Int, CarIcon>()

    init {
        lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                focus.take()
                if (q == null) task { next() } else task { prompt() }
            }

            override fun onStop(owner: LifecycleOwner) {
                job?.cancel()
                job = null
                player.stop()
                focus.release()
            }
        })
    }

    private fun task(block: suspend () -> Unit) {
        val old = job
        player.stop()
        job = lifecycleScope.launch {
            old?.cancelAndJoin()
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: SignedOut) {
                error = e.message ?: ""
                invalidate()
            } catch (e: Exception) {
                error = e.message ?: "Something went wrong."
                invalidate()
            }
        }
    }

    private suspend fun next() {
        error = ""
        val nq = make()
        q = nq
        last = nq.item
        picked = -1
        replays = 0
        hinted = false
        shownAt = SystemClock.elapsedRealtime()
        invalidate()
        prompt()
    }

    private suspend fun prompt() {
        val c = q ?: return
        when {
            c.syllable != null -> player.asset(c.syllable.audioAsset)
            c.number != null -> player.file(app.api.tts(Numbers.hanzi(c.number)))
        }
    }

    private suspend fun make(): Question = when (kind) {
        ChoiceKind.TONE, ChoiceKind.ZHUYIN -> {
            val all = app.content.syllables.filter { !it.zhuyin.contains("˙") }
            val item = all.filter { it.zhuyin != last }.random()
            val tone = Zhuyin.split(item.zhuyin).tone
            if (kind == ChoiceKind.TONE) {
                val opts = (1..4).map { t ->
                    Option(t.toString(), "Tone $t", toneIcons.getOrPut(t) { Glyph.tone(carContext, t) }, Zhuyin.TONE_NAME[t] ?: "")
                }
                Question(item.zhuyin, opts, tone - 1, syllable = item)
            } else {
                val symbols = Zhuyin.split(item.zhuyin).symbols
                val set = linkedSetOf(item.zhuyin)
                for (t in (1..4).filter { it != tone }.shuffled().take(2)) set.add(Zhuyin.withTone(item.zhuyin, t))
                for (s in all.filter { s -> s.zhuyin != item.zhuyin && Zhuyin.split(s.zhuyin).symbols.any { it in symbols } }.shuffled()) {
                    if (set.size >= 4) break
                    set.add(Zhuyin.withTone(s.zhuyin, tone))
                }
                for (s in all.shuffled()) {
                    if (set.size >= 4) break
                    set.add(s.zhuyin)
                }
                val keys = set.toList().shuffled()
                Question(item.zhuyin, keys.map { Option(it, it, Glyph.text(carContext, it, size = 150f)) }, keys.indexOf(item.zhuyin), syllable = item)
            }
        }
        ChoiceKind.CHARACTERS -> {
            val all = words ?: loadWords().also { words = it }
            val w = Characters.pick(all, last)!!
            val opts = Characters.choices(w, all, app.content.lookalikes)
            Question(w.text, opts.map { Option(it.text, it.english, null, it.text + " · " + it.zhuyin) }, opts.indexOfFirst { it.text == w.text }, word = w)
        }
        ChoiceKind.NUMBERS -> {
            val n = Numbers.randomIn(Numbers.randomBand())
            val opts = Numbers.choices(n)
            Question(
                n.toString(),
                opts.map { Option(it.toString(), Numbers.digits(it), Glyph.text(carContext, Numbers.digits(it), size = 120f, maxChars = 12)) },
                opts.indexOf(n),
                number = n,
            )
        }
    }

    /** The course words, and the words of the learner's sentences when they load (they are optional). */
    private suspend fun loadWords(): List<CharWord> {
        val mine = runCatching { Characters.sentenceWords(app.api.sentences()) }.getOrDefault(emptyList())
        return Characters.allWords(app.content.charDeck, mine)
    }

    private fun choose(i: Int) {
        val c = q ?: return
        if (picked >= 0 || i !in c.options.indices) return
        picked = i
        val ok = i == c.answer
        val o = c.options[i]
        app.scope.launch { app.api.event(event(c, o, ok)) }
        invalidate()
        task {
            if (ok) Sfx.right() else Sfx.wrong()
            // Characters: hear the word after the answer, like the web app.
            c.word?.let { player.file(app.api.tts(it.text)) }
            delay(if (ok) 1000 else 2500)
            next()
        }
    }

    /** The answer, saved like the web Listening, Characters, and Numbers quizzes. */
    private fun event(c: Question, o: Option, ok: Boolean): JSONObject {
        val ms = SystemClock.elapsedRealtime() - shownAt
        val optKeys = JSONArray(c.options.map { it.key })
        return when (kind) {
            ChoiceKind.TONE, ChoiceKind.ZHUYIN -> {
                val e = Zhuyin.parts(c.item)
                val units = JSONArray()
                if (kind == ChoiceKind.TONE) {
                    units.put(jsonOf("kind" to "tone", "expected" to e.tone, "actual" to o.key.toInt(), "ok" to ok, "ctx" to e.base))
                } else {
                    val a = Zhuyin.parts(o.key)
                    units.put(jsonOf("kind" to "tone", "expected" to e.tone, "actual" to a.tone, "ok" to (e.tone == a.tone), "ctx" to e.base))
                    units.put(jsonOf("kind" to "initial", "expected" to e.initial, "actual" to a.initial, "ok" to (e.initial == a.initial)))
                    units.put(jsonOf("kind" to "final", "expected" to e.final, "actual" to a.final, "ok" to (e.final == a.final)))
                    units.put(jsonOf("kind" to "syllable", "expected" to c.item, "actual" to o.key, "ok" to ok))
                }
                jsonOf(
                    "area" to "listening", "mode" to kind.name.lowercase(), "item" to c.item, "ok" to ok, "first_try" to ok,
                    "ms" to ms, "replays" to replays, "units" to units,
                    "details" to jsonOf("options" to optKeys, "picked" to o.key, "client" to "android-auto"),
                )
            }
            ChoiceKind.CHARACTERS -> {
                val w = c.word!!
                val good = ok && !hinted
                val lookalike = Characters.lookalikesOf(w.text, app.content.lookalikes).contains(o.key)
                jsonOf(
                    "area" to "characters", "mode" to "recognize", "item" to w.text, "ok" to ok, "first_try" to good,
                    "ms" to ms, "help" to hinted, "replays" to replays,
                    "units" to JSONArray().put(
                        jsonOf(
                            "kind" to "char", "expected" to w.text, "actual" to o.key, "ok" to ok, "help" to hinted, "ctx" to w.source,
                            "extra" to jsonOf("picked" to o.label, "lookalike" to lookalike),
                        ),
                    ),
                    "details" to jsonOf("options" to optKeys, "zhuyin" to w.zhuyin, "client" to "android-auto"),
                )
            }
            ChoiceKind.NUMBERS -> {
                val n = c.number!!
                val p = o.key.toLong()
                jsonOf(
                    "area" to "numbers", "mode" to "listen", "item" to n.toString(), "ok" to ok, "first_try" to ok,
                    "ms" to ms, "replays" to replays,
                    "units" to JSONArray().put(
                        jsonOf(
                            "kind" to "number", "expected" to n.toString(), "actual" to o.key, "ok" to ok, "ctx" to Numbers.band(n),
                            "extra" to jsonOf("hanzi" to Numbers.hanzi(n), "error" to Numbers.errorOf(n, p)),
                        ),
                    ),
                    "details" to jsonOf("options" to JSONArray(c.options.map { it.key.toLong() }), "picked" to p, "hanzi" to Numbers.hanzi(n), "client" to "android-auto"),
                )
            }
        }
    }

    private fun replay() {
        val c = q ?: return
        if (picked < 0) replays += 1
        if (c.word != null) {
            // Characters: the hint plays the word and shows its Bopomofo. Before the answer, it counts as help.
            if (picked < 0) hinted = true
            invalidate()
            task { player.file(app.api.tts(c.word.text)) }
        } else {
            task { prompt() }
        }
    }

    private fun mark(c: Question, i: Int, label: String): String = when {
        picked < 0 -> label
        i == c.answer -> "✓ $label"
        i == picked -> "✗ $label"
        else -> label
    }

    override fun onGetTemplate(): Template {
        val c = q
        if (c == null) {
            if (error.isNotEmpty()) {
                return ListTemplate.Builder().setTitle(kind.title).setHeaderAction(Action.BACK)
                    .setSingleList(ItemList.Builder().setNoItemsMessage(error).build()).build()
            }
            return if (kind == ChoiceKind.CHARACTERS) {
                ListTemplate.Builder().setTitle(kind.title).setHeaderAction(Action.BACK).setLoading(true).build()
            } else {
                GridTemplate.Builder().setTitle(kind.title).setHeaderAction(Action.BACK).setLoading(true).build()
            }
        }
        if (kind == ChoiceKind.CHARACTERS) return charactersTemplate(c)
        val list = ItemList.Builder()
        c.options.forEachIndexed { i, o ->
            val item = GridItem.Builder()
                .setTitle(mark(c, i, o.label))
                .setImage(o.icon!!, GridItem.IMAGE_TYPE_LARGE)
                .setOnClickListener { choose(i) }
            val sub = when {
                kind == ChoiceKind.TONE -> o.after
                picked >= 0 && i == c.answer && c.syllable != null -> c.syllable.char + " " + c.syllable.zhuyin
                picked >= 0 && i == c.answer && c.number != null -> Numbers.hanzi(c.number)
                else -> ""
            }
            if (sub.isNotEmpty()) item.setText(sub)
            list.addItem(item.build())
        }
        return GridTemplate.Builder()
            .setTitle(kind.title)
            .setHeaderAction(Action.BACK)
            .setSingleList(list.build())
            .setActionStrip(ActionStrip.Builder().addAction(Action.Builder().setTitle("Replay").setOnClickListener { replay() }.build()).build())
            .build()
    }

    private fun charactersTemplate(c: Question): Template {
        val w = c.word!!
        val list = ItemList.Builder()
        val head = Row.Builder()
            .setTitle(if (picked >= 0 || hinted) w.text + " · " + w.zhuyin else "Tap here for a hint")
            .setImage(Glyph.text(carContext, w.text, size = 200f, maxChars = 4), Row.IMAGE_TYPE_LARGE)
            .setOnClickListener { replay() }
        if (picked >= 0) head.addText(w.french?.let { "Français : $it" } ?: if (w.fromSentences) "From your sentences" else "From the course")
        else if (hinted) head.addText("Hint used: this one counts as help.")
        list.addItem(head.build())
        c.options.forEachIndexed { i, o ->
            val r = Row.Builder().setTitle(mark(c, i, o.label)).setOnClickListener { choose(i) }
            if (picked >= 0) r.addText(o.after)
            list.addItem(r.build())
        }
        return ListTemplate.Builder()
            .setTitle(kind.title)
            .setHeaderAction(Action.BACK)
            .setSingleList(list.build())
            .build()
    }
}
