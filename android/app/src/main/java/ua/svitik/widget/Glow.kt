package ua.svitik.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.BitmapDrawable

/**
 * The app's backdrop: black with two large glowing rings, one above and one below the screen, in the
 * colour of the power state, for the glass cards to sit on. Blurred strokes need a software canvas,
 * so it is drawn once per colour into a half-size bitmap (the glow is soft, scaling loses nothing).
 */
object Glow {
    const val GREEN = 0xFF00FF88.toInt()
    const val RED = 0xFFFF3B3B.toInt()
    const val AMBER = 0xFFFF9F1A.toInt()

    fun accent(power: PowerNow) = when {
        power.emergency -> AMBER
        power.off -> RED
        else -> GREEN
    }

    fun background(context: Context, accent: Int): BitmapDrawable {
        val metrics = context.resources.displayMetrics
        val width = metrics.widthPixels / 2
        val height = metrics.heightPixels / 2
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.BLACK)
        ring(canvas, width * 0.5f, -height * 0.13f, width * 0.78f, accent, width)
        ring(canvas, width * 0.5f, height * 1.16f, width * 0.98f, accent, width)
        return BitmapDrawable(context.resources, bitmap)
    }

    // A wide faint halo, a narrower glow and a thin bright rim
    private fun ring(canvas: Canvas, x: Float, y: Float, radius: Float, accent: Int, width: Int) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
        for ((stroke, blur, alpha) in listOf(
            Triple(width * 0.10f, width * 0.10f, 60),
            Triple(width * 0.03f, width * 0.03f, 130),
            Triple(width * 0.005f, width * 0.004f, 225),
        )) {
            paint.color = accent
            paint.alpha = alpha
            paint.strokeWidth = stroke
            paint.maskFilter = BlurMaskFilter(blur, BlurMaskFilter.Blur.NORMAL)
            canvas.drawCircle(x, y, radius, paint)
        }
    }
}
