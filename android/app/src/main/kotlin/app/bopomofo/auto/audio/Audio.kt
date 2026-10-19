package app.bopomofo.auto.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.MediaPlayer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/** Playback goes through the media channel, which Android Auto always routes to the car speakers. */
val PLAY_ATTRS: AudioAttributes = AudioAttributes.Builder()
    .setUsage(AudioAttributes.USAGE_MEDIA)
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .build()

/**
 * Audio focus for a practice screen. The car microphone needs exclusive focus (Android for Cars docs), and it
 * also pauses the music while the learner practices. Released when the screen stops.
 */
class Focus(context: Context) {
    private val am = context.getSystemService(AudioManager::class.java)
    private var request: AudioFocusRequest? = null

    fun take(): Boolean {
        if (request != null) return true
        val r = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setOnAudioFocusChangeListener { }
            .build()
        val ok = am.requestAudioFocus(r) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (ok) request = r
        return ok
    }

    fun release() {
        request?.let { am.abandonAudioFocusRequest(it) }
        request = null
    }
}

/** Plays one clip at a time and suspends until it ends. Cancelling the coroutine stops the clip. */
class Player(private val context: Context) {
    private var current: MediaPlayer? = null

    suspend fun asset(path: String) = play { p ->
        context.assets.openFd(path).use { p.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
    }

    suspend fun file(f: File) = play { p -> p.setDataSource(f.path) }

    private suspend fun play(source: (MediaPlayer) -> Unit) = withContext(Dispatchers.Main) {
        stop()
        suspendCancellableCoroutine { cont ->
            val p = MediaPlayer()
            current = p
            fun done() {
                if (current === p) stop()
                if (cont.isActive) cont.resume(Unit)
            }
            p.setAudioAttributes(PLAY_ATTRS)
            p.setOnCompletionListener { done() }
            p.setOnErrorListener { _, _, _ ->
                done()
                true
            }
            p.setOnPreparedListener { it.start() }
            try {
                source(p)
                p.prepareAsync()
            } catch (e: Exception) {
                done()
            }
            cont.invokeOnCancellation { android.os.Handler(android.os.Looper.getMainLooper()).post { if (current === p) stop() } }
        }
    }

    fun stop() {
        val p = current ?: return
        current = null
        runCatching { p.stop() }
        p.release()
    }
}

/** Short sound cues, so the driver knows what happens without looking: listening, right, wrong. */
object Sfx {
    private const val RATE = 22050

    suspend fun listen() = play(listOf(880.0 to 70), 0.25)
    suspend fun right() = play(listOf(660.0 to 90, 990.0 to 140), 0.3)
    suspend fun wrong() = play(listOf(233.0 to 220), 0.3)

    private suspend fun play(notes: List<Pair<Double, Int>>, gain: Double) = withContext(Dispatchers.IO) {
        val total = notes.sumOf { it.second } * RATE / 1000
        val pcm = ShortArray(total)
        var o = 0
        for ((hz, ms) in notes) {
            val n = ms * RATE / 1000
            val fade = min(n / 4, RATE / 100)
            for (i in 0 until n) {
                val env = min(1.0, min(i, n - 1 - i).toDouble() / fade)
                pcm[o + i] = (sin(2 * PI * hz * i / RATE) * env * gain * Short.MAX_VALUE).toInt().toShort()
            }
            o += n
        }
        val track = AudioTrack.Builder()
            .setAudioAttributes(PLAY_ATTRS)
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build(),
            )
            .setTransferMode(AudioTrack.MODE_STATIC)
            .setBufferSizeInBytes(pcm.size * 2)
            .build()
        try {
            track.write(pcm, 0, pcm.size)
            track.play()
            delay(notes.sumOf { it.second }.toLong() + 60)
        } finally {
            runCatching { track.stop() }
            track.release()
        }
    }
}
