package com.stonedragon.schedule

import android.graphics.Color

/**
 * The widget's palette, matching the web app's theme picker.
 *
 * The colours are the app's `--primary-bright` values, not `--primary`: bright
 * is what the app actually draws accents with, and a widget sits on whatever
 * wallpaper the phone has rather than on the app's dark page, so the more
 * legible of the two is the right one to copy.
 *
 * Accent and background are stored SEPARATELY here, unlike the app where
 * picking "White" gets you a light page. On a home screen the two are genuinely
 * independent choices — a purple accent on a light widget is a reasonable thing
 * to want next to a pale wallpaper, and the app's coupling would forbid it.
 */
internal data class Accent(val id: String, val label: String, val color: Int)

internal object Theme {

    val ACCENTS = listOf(
        Accent("blue", "Blue", Color.parseColor("#22D3EE")),
        Accent("teal", "Teal", Color.parseColor("#2DD4BF")),
        Accent("green", "Green", Color.parseColor("#5EEA8D")),
        Accent("yellow", "Yellow", Color.parseColor("#FBBF24")),
        Accent("orange", "Orange", Color.parseColor("#FB923C")),
        Accent("red", "Red", Color.parseColor("#F87171")),
        Accent("pink", "Pink", Color.parseColor("#F472B6")),
        Accent("purple", "Purple", Color.parseColor("#C084FC")),
        Accent("slate", "Slate", Color.parseColor("#CBD5E1")),
        Accent("ink", "Ink", Color.parseColor("#334155")),
    )

    fun accentOf(id: String): Accent = ACCENTS.firstOrNull { it.id == id } ?: ACCENTS[0]

    // Surfaces. Two sets, because the only thing a background has to do is let
    // the text on it be read.
    private const val DARK_TEXT = "#E6EDF7"
    private const val DARK_MUTED = "#8A9BB4"
    private const val LIGHT_TEXT = "#0B1220"
    private const val LIGHT_MUTED = "#5A6A80"

    fun textColor(light: Boolean): Int =
        Color.parseColor(if (light) LIGHT_TEXT else DARK_TEXT)

    fun mutedColor(light: Boolean): Int =
        Color.parseColor(if (light) LIGHT_MUTED else DARK_MUTED)

    fun bgRes(light: Boolean): Int =
        if (light) R.drawable.widget_bg_light else R.drawable.widget_bg

    /**
     * An accent chosen for a dark widget can be unreadable on a light one —
     * "Ink" is nearly black and vanishes on dark, "Slate" is nearly white and
     * vanishes on light. Rather than forbid combinations, the two that actually
     * disappear are swapped for their opposite number, so every pick stays
     * legible on either background instead of silently rendering invisible text.
     */
    fun accentFor(id: String, light: Boolean): Int {
        val a = accentOf(id)
        if (light && a.id == "slate") return Color.parseColor("#475569")
        if (!light && a.id == "ink") return Color.parseColor("#94A3B8")
        return a.color
    }
}
