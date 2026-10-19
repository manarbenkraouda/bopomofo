package app.bopomofo.auto.audio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import androidx.car.app.CarContext
import androidx.car.app.media.CarAudioRecord
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.Closeable
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

const val SAMPLE_RATE = 16000

/** 16 kHz mono PCM from a microphone. */
interface MicSource : Closeable {
    /** Samples read into buf, or -1 when the microphone closed. */
    fun read(buf: ShortArray): Int
}

/** The car's microphone, through Android Auto (car API level 5). */
@SuppressLint("MissingPermission")
private class CarMic(context: CarContext) : MicSource {
    private val rec = CarAudioRecord.create(context).also { it.startRecording() }
    private val bytes = ByteArray(CarAudioRecord.AUDIO_CONTENT_BUFFER_SIZE)

    override fun read(buf: ShortArray): Int {
        val n = rec.read(bytes, 0, min(bytes.size, buf.size * 2))
        if (n < 0) return -1
        val sb = ByteBuffer.wrap(bytes, 0, n).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
        val count = sb.remaining()
        sb.get(buf, 0, count)
        return count
    }

    override fun close() {
        runCatching { rec.stopRecording() }
    }
}

/** The phone's microphone: the fallback when the car does not give its own. */
@SuppressLint("MissingPermission")
private class PhoneMic : MicSource {
    private val rec: AudioRecord

    init {
        val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        rec = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION, SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(min, 6400) * 2,
        )
        if (rec.state != AudioRecord.STATE_INITIALIZED) {
            rec.release()
            throw IOException("The microphone is not available.")
        }
        rec.startRecording()
    }

    override fun read(buf: ShortArray): Int = rec.read(buf, 0, buf.size).let { if (it < 0) -1 else it }

    override fun close() {
        runCatching { rec.stop() }
        rec.release()
    }
}

object Mic {
    fun open(context: CarContext): MicSource =
        if (context.carAppApiLevel >= 5) {
            try {
                CarMic(context)
            } catch (e: Exception) {
                PhoneMic()
            }
        } else {
            PhoneMic()
        }
}

sealed interface Heard {
    class Speech(val wav: ByteArray, val seconds: Double) : Heard
    data object Silence : Heard
}

/**
 * Hands-free listening, ported from the web Reading page (frontend/src/lib/listener.ts): speech starts when the
 * level rises above the room noise, and ends after a short silence. Each clip keeps 0.3 s before and after.
 */
class Listener(private val open: () -> MicSource) {

    /** One utterance, or Silence when nobody speaks for waitMs. onQuiet: a sound above the noise but too soft. */
    suspend fun listen(waitMs: Long, maxS: Double, endS: Double, onQuiet: () -> Unit): Heard = withContext(Dispatchers.IO) {
        val mic = open()
        try {
            val vad = Vad(maxS, endS)
            val buf = ShortArray(1600)
            val frame = ShortArray(Vad.FRAME)
            var fill = 0
            val start = SystemClock.elapsedRealtime()
            while (true) {
                ensureActive()
                val n = mic.read(buf)
                if (n < 0) throw IOException("The microphone closed.")
                for (i in 0 until n) {
                    frame[fill++] = buf[i]
                    if (fill < Vad.FRAME) continue
                    fill = 0
                    when (val e = vad.feed(frame.copyOf())) {
                        is Vad.Done -> return@withContext Heard.Speech(wav(e.pcm), e.pcm.size.toDouble() / SAMPLE_RATE)
                        Vad.Quiet -> onQuiet()
                        else -> {}
                    }
                }
                if (!vad.speaking && SystemClock.elapsedRealtime() - start > waitMs) return@withContext Heard.Silence
            }
            @Suppress("UNREACHABLE_CODE")
            throw IllegalStateException()
        } finally {
            mic.close()
        }
    }
}

class Vad(maxS: Double, endS: Double) {
    sealed interface Event
    class Done(val pcm: ShortArray) : Event
    data object Quiet : Event
    data object Short : Event

    private val endFrames = (endS / FRAME_S).toInt()
    private val maxFrames = (maxS / FRAME_S).toInt()
    private val ring = ArrayDeque<ShortArray>()
    private var speech = mutableListOf<ShortArray>()
    private var loud = 0
    private var soft = 0
    private var quiet = 0
    private var first = 0
    private var last = 0
    private var noise = 0.003
    var speaking = false
        private set

    fun feed(f: ShortArray): Event? {
        var s = 0.0
        for (v in f) {
            val x = v / 32768.0
            s += x * x
        }
        val rms = sqrt(s / f.size)
        val on = max(0.005, noise * 3)
        if (!speaking) {
            // Track the room (or road) noise only while nobody speaks.
            if (rms < on) noise = noise * 0.97 + min(rms, 0.03) * 0.03
            ring.addLast(f)
            if (ring.size > PAD + START) ring.removeFirst()
            loud = if (rms > on) loud + 1 else 0
            if (rms > max(0.002, noise * 1.8) && rms <= on) {
                if (++soft == QUIET_FRAMES) return Quiet
            } else if (rms <= on) {
                soft = 0
            }
            if (loud >= START) {
                val firstLoud = ring.size - loud
                val from = max(0, firstLoud - PAD)
                speech = ring.toList().subList(from, ring.size).toMutableList()
                first = firstLoud - from
                last = speech.size - 1
                ring.clear()
                speaking = true
                quiet = 0
                soft = 0
            }
            return null
        }
        speech.add(f)
        if (rms > on * 0.5) {
            last = speech.size - 1
            quiet = 0
        } else {
            quiet += 1
        }
        if (quiet >= endFrames || speech.size >= maxFrames) return finish()
        return null
    }

    private fun finish(): Event {
        val frames = speech.subList(0, min(speech.size, last + 1 + PAD))
        val voiced = last - first + 1
        val all = ShortArray(frames.sumOf { it.size })
        var o = 0
        for (fr in frames) {
            fr.copyInto(all, o)
            o += fr.size
        }
        speech = mutableListOf()
        speaking = false
        loud = 0
        soft = 0
        quiet = 0
        return if (voiced < MIN_FRAMES) Short else Done(all)
    }

    companion object {
        const val FRAME = 320 // 20 ms at 16 kHz
        private const val FRAME_S = 0.02
        private const val PAD = 15 // 0.3 s
        private const val START = 3 // 0.06 s of loud frames to start
        private const val MIN_FRAMES = 5 // 0.1 s
        private const val QUIET_FRAMES = 8 // 0.16 s
    }
}

/** 16-bit mono WAV, as the web app sends (lib/recorder.ts). */
fun wav(pcm: ShortArray, rate: Int = SAMPLE_RATE): ByteArray {
    val data = pcm.size * 2
    val b = ByteBuffer.allocate(44 + data).order(ByteOrder.LITTLE_ENDIAN)
    b.put("RIFF".toByteArray()).putInt(36 + data).put("WAVE".toByteArray())
    b.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(rate).putInt(rate * 2).putShort(2).putShort(16)
    b.put("data".toByteArray()).putInt(data)
    for (v in pcm) b.putShort(v)
    return b.array()
}
