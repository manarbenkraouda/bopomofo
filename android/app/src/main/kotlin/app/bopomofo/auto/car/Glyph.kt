package app.bopomofo.auto.car

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.car.app.CarContext
import androidx.car.app.model.CarIcon
import androidx.core.graphics.createBitmap
import androidx.core.graphics.drawable.IconCompat
import kotlin.math.ceil
import kotlin.math.max

/** Templates show text small. Symbols, characters, and digits are drawn as images, so they are big on the car screen. */
object Glyph {
    private fun ink(ctx: CarContext) = if (ctx.isDarkMode) Color.WHITE else Color.rgb(20, 20, 24)
    private fun accent(ctx: CarContext) = if (ctx.isDarkMode) Color.rgb(255, 140, 90) else Color.rgb(214, 70, 30)

    /** Text drawn centered in a square, wrapped to at most maxChars per line. */
    fun text(ctx: CarContext, text: String, size: Float = 200f, maxChars: Int = 8, square: Boolean = true): CarIcon {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ink(ctx)
            textSize = size
        }
        val lines = text.split('\n').flatMap { it.chunked(maxChars) }
        val widest = lines.maxOf { Layout.getDesiredWidth(it, paint) }
        val w = max(1, ceil(widest).toInt() + 4)
        val layout = StaticLayout.Builder.obtain(lines.joinToString("\n"), 0, lines.joinToString("\n").length, paint, w)
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .setIncludePad(false)
            .build()
        val pad = (size * 0.12f).toInt()
        val bw = w + 2 * pad
        val bh = layout.height + 2 * pad
        val side = max(bw, bh)
        val bmp = if (square) createBitmap(side, side) else createBitmap(bw, bh)
        val c = Canvas(bmp)
        c.translate((bmp.width - w) / 2f, (bmp.height - layout.height) / 2f)
        layout.draw(c)
        return icon(bmp)
    }

    /** The pitch shape of a tone on the 5-level scale: 1 = 55, 2 = 35, 3 = 21(4), 4 = 51. */
    fun tone(ctx: CarContext, tone: Int): CarIcon {
        val s = 240
        val bmp = createBitmap(s, s)
        val c = Canvas(bmp)
        val guide = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = ink(ctx)
            alpha = 60
            strokeWidth = 3f
        }
        val top = 40f
        val bottom = 200f
        for (i in 0..4) {
            val y = top + (bottom - top) * i / 4
            c.drawLine(30f, y, 210f, y, guide)
        }
        fun y(level: Double) = (bottom - (bottom - top) * (level - 1) / 4).toFloat()
        val pts = when (tone) {
            1 -> listOf(5.0, 5.0)
            2 -> listOf(3.0, 5.0)
            3 -> listOf(2.0, 1.0, 1.2, 3.5)
            else -> listOf(5.0, 1.0)
        }
        val path = Path()
        pts.forEachIndexed { i, lv ->
            val x = 40f + 160f * i / (pts.size - 1)
            if (i == 0) path.moveTo(x, y(lv)) else path.lineTo(x, y(lv))
        }
        val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = accent(ctx)
            style = Paint.Style.STROKE
            strokeWidth = 22f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        c.drawPath(path, line)
        return icon(bmp)
    }

    private fun icon(bmp: Bitmap) = CarIcon.Builder(IconCompat.createWithBitmap(bmp)).build()
}
