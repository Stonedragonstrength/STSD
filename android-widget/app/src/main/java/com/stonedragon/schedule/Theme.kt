package com.stonedragon.schedule

// No android.graphics import: Theme must initialise on a bare JVM (see c()).
// import android.graphics.Color

/**
 * The widget's palette.
 *
 * Each accent carries TWO colours, not one. A neon that sings against the dark
 * surface is close to invisible on the light one — #3DFF77 on #F2F6FA is pale
 * green text on near-white — so every accent has a deep counterpart in the same
 * hue for light backgrounds. Same choice, legible either way, rather than eight
 * colours that only work on one of the two surfaces the widget offers.
 *
 * These are hotter than the web app's `--primary-bright` values, which are
 * Tailwind 400s and read muted on a phone at arm's length behind a wallpaper.
 * The hues still track the app's themes so the two read as one product.
 *
 * Slate and Ink are deliberately NOT neon — they are the neutral choices, the
 * widget's equivalent of the app's Black and White themes.
 */
internal data class Accent(
    val id: String,
    val label: String,
    /** For the dark surface: saturated, high-luminance. */
    val neon: Int,
    /** For the light surface: same hue, deep enough to read on near-white. */
    val deep: Int,
)

internal object Theme {

    /**
     * `#RRGGBB` / `#AARRGGBB` to an ARGB Int, by hand rather than through
     * `Color.parseColor`.
     *
     * Not a style choice. `Theme` is an object, so every property initialiser
     * runs the first time ANYTHING in it is touched — and `Color.parseColor`
     * throws "not mocked" on a bare JVM. One Android call in one initialiser
     * made the entire palette, and every function beside it, impossible to
     * unit test. These are compile-time constants; nothing about them needed a
     * framework call.
     */
    private fun c(s: String): Int {
        val hex = s.removePrefix("#")
        val v = hex.toLong(16)
        return if (hex.length <= 6) (0xFF000000L or v).toInt() else v.toInt()
    }

    val ACCENTS = listOf(
        Accent("blue",     "Blue",     c("#00E1FF"), c("#0083A0")),
        // The DARK blue, tracking the app's sapphire theme — its neon has to
        // stay this luminous to read on the dark panel; the slider's top half
        // is how it gets navy-dark, and its deep twin gives that a head start.
        Accent("sapphire", "Sapphire", c("#4D7EFF"), c("#1D4ED8")),
        Accent("teal",     "Teal",     c("#00FFC6"), c("#00907A")),
        Accent("green",    "Green",    c("#3DFF77"), c("#1B9440")),
        Accent("yellow",   "Yellow",   c("#FFE01B"), c("#8F6E00")),
        Accent("orange",   "Orange",   c("#FF8A1F"), c("#B85200")),
        Accent("red",      "Red",      c("#FF3355"), c("#BE1330")),
        Accent("pink",     "Pink",     c("#FF3DA6"), c("#B80F6E")),
        Accent("purple",   "Purple",   c("#B266FF"), c("#6D1FD1")),
        Accent("slate",    "Slate",    c("#D9E2EC"), c("#475569")),
        Accent("ink",      "Ink",      c("#94A3B8"), c("#1E293B")),
    )

    fun accentOf(id: String): Accent = ACCENTS.firstOrNull { it.id == id } ?: ACCENTS[0]

    /** The accent as it will actually be drawn on the current surface. */
    fun accentFor(id: String, light: Boolean): Int =
        accentOf(id).let { if (light) it.deep else it.neon }

    // Surfaces. The only job a background has is to let the text on it be read.
    private const val DARK_TEXT = "#E6EDF7"
    private const val DARK_MUTED = "#8A9BB4"
    private const val LIGHT_TEXT = "#0B1220"
    private const val LIGHT_MUTED = "#5A6A80"

    fun textColor(light: Boolean): Int = c(if (light) LIGHT_TEXT else DARK_TEXT)

    fun mutedColor(light: Boolean): Int = c(if (light) LIGHT_MUTED else DARK_MUTED)

    // ---- Saturation and transparency ----
    //
    // Both are pure functions on purpose. They are the only part of the
    // widget's LOOK that can be settled without a phone, so they are written to
    // be settled that way.

    /**
     * The top of the slider's range. One constant, so the config screen's max,
     * the clamps here and the tests cannot quietly disagree about where the
     * range ends — a layout capped at 100 would amputate the whole darkening
     * half with no failure anywhere.
     */
    const val SAT_MAX = 2f

    /** How much of a colour the darkest slider position takes away. */
    private const val DARKEN_MAX = 0.65f

    /**
     * Straight per-channel mix from one colour toward another, alpha kept from
     * [from]. The one channel-unpack/lerp/repack in this file — saturate's
     * darkening half, tone's crossfade and mutedColor's lift are all this.
     */
    private fun blend(from: Int, to: Int, t: Float): Int {
        val k = t.coerceIn(0f, 1f)
        fun m(s: Int): Int {
            val f = (from shr s) and 0xFF
            return (f + (((to shr s) and 0xFF) - f) * k).toInt().coerceIn(0, 255)
        }
        return (from and 0xFF000000.toInt()) or (m(16) shl 16) or (m(8) shl 8) or m(0)
    }

    /**
     * The slider's whole journey for one colour: grey at 0, the colour itself
     * at 1, darker past that. The top half used to not exist — the slider ended
     * at the theme colour, and the coach reads that as only half the range.
     *
     * Below 1 it scales saturation toward grey, leaving hue and alpha alone.
     * Done by mixing toward the colour's own luma rather than through HSV: the
     * result is the same to the eye, and it keeps Theme free of
     * android.graphics, which is what makes every function here testable.
     *
     * Rec. 601 luma, not a flat average — a flat average turns yellow muddy and
     * blue nearly black, because the eye does not weight the channels equally.
     *
     * Above 1 it blends toward black, 65% gone at SAT_MAX. The cap is what
     * keeps the far end a colour rather than a hole in the widget — this path
     * serves text and athlete edges too, not just the accent, and those have
     * no deep twin to hand the job to (see tone for the one that does).
     */
    fun saturate(color: Int, amount: Float): Int {
        val a = amount.coerceIn(0f, SAT_MAX)
        if (a == 1f) return color
        if (a > 1f) return blend(color, color and 0xFF000000.toInt(), (a - 1f) * DARKEN_MAX)
        val r = (color shr 16) and 0xFF
        val g = (color shr 8) and 0xFF
        val b = color and 0xFF
        val grey = 0.299f * r + 0.587f * g + 0.114f * b
        fun mix(ch: Int) = (grey + (ch - grey) * a).toInt().coerceIn(0, 255)
        return (color and 0xFF000000.toInt()) or (mix(r) shl 16) or (mix(g) shl 8) or mix(b)
    }

    /**
     * The accent's journey, which is richer than a lone colour's: past the
     * middle it first crosses to the SAME hue's hand-picked deep twin —
     * "darker" for an accent should mean the curated dark version, not neon
     * with the lights turned down — and only then darkens that toward black.
     * Told which surface it is on rather than left to infer it: on the light
     * surface the base already IS the deep twin, so its whole top half is one
     * long darken — a dead zone where the slider moved and nothing changed
     * would read as broken.
     */
    fun tone(acc: Accent, light: Boolean, amount: Float): Int {
        val a = amount.coerceIn(0f, SAT_MAX)
        val base = if (light) acc.deep else acc.neon
        if (a <= 1f || light) return saturate(base, a)
        if (a <= 1.5f) return blend(base, acc.deep, (a - 1f) * 2f)
        return saturate(acc.deep, 1f + (a - 1.5f) * 2f)
    }

    /** The accent as it is actually drawn: the surface's pick, at the slider. */
    fun accentToned(id: String, light: Boolean, amount: Float): Int =
        tone(accentOf(id), light, amount)

    /**
     * How opaque the panel is drawn, 0..255, from a 0f..1f preference.
     *
     * Deliberately floored well above zero. A widget that can be made to vanish
     * completely is one the coach cannot find to fix — and the settings are
     * reached from the widget, so an invisible widget is an unreachable
     * setting. "Glass" means faint, not gone.
     */
    fun panelAlpha(opacity: Float): Int {
        val o = opacity.coerceIn(0f, 1f)
        return (GLASS_FLOOR + (255 - GLASS_FLOOR) * o).toInt().coerceIn(0, 255)
    }

    // Lowered from 38 (~15%) on request: the coach wanted glassier. The rows
    // and text never fade with the panel, so the widget stays findable by its
    // own content — the floor now only guards against a literal zero.
    private const val GLASS_FLOOR = 10 // ~4%

    /**
     * Muted text, lifted toward the main text colour as the panel clears.
     *
     * The panel getting more transparent must not make the writing harder to
     * read, and the widget has no idea what wallpaper is behind it — so the
     * quieter the surface, the less the secondary text is allowed to recede.
     * At full opacity this is exactly the colour it has always been.
     */
    fun mutedColor(light: Boolean, opacity: Float): Int {
        val o = opacity.coerceIn(0f, 1f)
        // At glass, three-quarters of the way to full text colour: enough to
        // stay legible, still distinguishable from the primary text.
        return blend(mutedColor(light), textColor(light), (1f - o) * 0.75f)
    }

    fun bgRes(light: Boolean): Int =
        if (light) R.drawable.widget_bg_light else R.drawable.widget_bg

    // ---- The athlete's own colour ----
    //
    // Not an accent, and deliberately not themed: this is the SAME colour the
    // web app gives that athlete on their avatar, their roster card and their
    // session rows. The widget carrying a different one would be worse than
    // carrying none, because it would look deliberate.

    /**
     * The web app's AVATAR_COLORS, in the same order. The order is the
     * contract, not the values — athleteColorIdx returns a position in THIS
     * array, so reordering silently re-colours the whole roster.
     */
    val athletePalette = intArrayOf(
        c("#06b6d4"), c("#10b981"), c("#8b5cf6"), c("#f59e0b"),
        c("#ef4444"), c("#ec4899"), c("#3b82f6"), c("#f97316"),
    )

    /**
     * djb2, ported from app.js `athleteColorIdx`.
     *
     * The JS is `h = ((h << 5) + h + ch) | 0`, where `| 0` coerces to a SIGNED
     * 32-BIT int on every step. Kotlin's Int is already 32-bit and overflows
     * the same way, so no explicit coercion is needed — but the accumulator
     * MUST stay Int. Widen it to Long and the two implementations diverge
     * silently, which is the exact bug AthleteColorTest exists to catch.
     */
    fun athleteColorIdx(key: String): Int {
        var h = 5381
        for (ch in key) h = (h shl 5) + h + ch.code
        return kotlin.math.abs(h) % athletePalette.size
    }

    /** The id decides; the name is the fallback for rows that carry no id. */
    fun athleteColor(id: String, name: String): Int =
        athletePalette[athleteColorIdx(id.ifBlank { name })]
}
