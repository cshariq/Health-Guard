package ca.lumen.brightspace

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.luminance

object Palette {
    /** Stable hue (degrees) for a course — mirrors the web app / iOS. */
    fun hue(key: String): Double {
        var x = 2166136261u
        for (b in key.toByteArray()) { x = x xor b.toUInt(); x *= 16777619u }
        val palette = doubleArrayOf(265.0, 200.0, 150.0, 30.0, 340.0, 85.0, 230.0, 300.0, 175.0, 10.0, 120.0, 250.0)
        return palette[(x % palette.size.toUInt()).toInt()]
    }
    fun accent(hue: Double, dark: Boolean): Color =
        if (dark) Color.hsv(hue.toFloat(), 0.55f, 0.85f) else Color.hsv(hue.toFloat(), 0.72f, 0.70f)
    fun container(hue: Double, dark: Boolean): Color =
        if (dark) Color.hsv(hue.toFloat(), 0.35f, 0.32f) else Color.hsv(hue.toFloat(), 0.18f, 0.95f)
    fun banner(hue: Double, dark: Boolean): Brush = Brush.linearGradient(
        if (dark) listOf(Color.hsv(hue.toFloat(), 0.5f, 0.42f), Color.hsv(((hue + 25) % 360).toFloat(), 0.5f, 0.30f))
        else listOf(Color.hsv(hue.toFloat(), 0.62f, 0.58f), Color.hsv(((hue + 25) % 360).toFloat(), 0.6f, 0.45f))
    )
    const val SEED = 265.0
}

@Composable
fun LumenTheme(mode: String, content: @Composable () -> Unit) {
    val dark = when (mode) { "light" -> false; "dark" -> true; else -> isSystemInDarkTheme() }
    val accent = Palette.accent(Palette.SEED, dark)
    val colors = if (dark)
        darkColorScheme(primary = accent, secondary = accent)
    else
        lightColorScheme(primary = accent, secondary = accent)
    MaterialTheme(colorScheme = colors, content = content)
}

/** True when the theme actually applied is dark (respects the Settings override, not just the system setting). */
@Composable
fun isDarkTheme(): Boolean = MaterialTheme.colorScheme.background.luminance() < 0.5f
