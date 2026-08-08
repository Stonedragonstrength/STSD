package com.stonedragon.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Saturation and transparency, which are pure maths and therefore the parts of
 * the widget's look that CAN be settled without a phone.
 *
 * Channel helpers are written here by hand rather than using
 * android.graphics.Color, for the same reason Theme parses hex itself: an
 * Android call in a plain JVM test throws "not mocked" and takes the whole
 * class down with it.
 */
class ThemeTest {

    private fun a(c: Int) = (c ushr 24) and 0xFF
    private fun r(c: Int) = (c shr 16) and 0xFF
    private fun g(c: Int) = (c shr 8) and 0xFF
    private fun b(c: Int) = c and 0xFF

    /** Chroma stands in for saturation: max channel minus min channel. */
    private fun chroma(c: Int) = maxOf(r(c), g(c), b(c)) - minOf(r(c), g(c), b(c))

    /** Which channel is largest, which smallest — a proxy for hue surviving. */
    private fun order(c: Int): List<Int> =
        listOf(0 to r(c), 1 to g(c), 2 to b(c)).sortedBy { it.second }.map { it.first }

    // ---- saturation ----

    @Test
    fun fullSaturationIsANoOp() {
        Theme.athletePalette.forEach { assertEquals(it, Theme.saturate(it, 1f)) }
        Theme.ACCENTS.forEach { assertEquals(it.neon, Theme.saturate(it.neon, 1f)) }
    }

    @Test
    fun mutingIsMonotonicTowardGrey() {
        Theme.athletePalette.forEach { colour ->
            val steps = listOf(1f, 0.75f, 0.5f, 0.25f, 0f).map { chroma(Theme.saturate(colour, it)) }
            steps.zipWithNext { hi, lo ->
                assertTrue("chroma should never rise as it mutes: $steps", lo <= hi)
            }
            assertEquals("fully muted is grey", 0, steps.last())
        }
    }

    @Test
    fun mutingNeverReordersTheChannels() {
        // A hue shift would show up as red/green/blue swapping rank.
        Theme.athletePalette.forEach { colour ->
            val before = order(colour)
            listOf(0.75f, 0.5f, 0.25f).forEach { amt ->
                assertEquals("hue moved at $amt", before, order(Theme.saturate(colour, amt)))
            }
        }
    }

    @Test
    fun saturationNeverTouchesAlphaAndStaysInRange() {
        Theme.athletePalette.forEach { colour ->
            listOf(0f, 0.3f, 1f).forEach { amt ->
                val out = Theme.saturate(colour, amt)
                assertEquals(a(colour), a(out))
                listOf(r(out), g(out), b(out)).forEach {
                    assertTrue("channel $it out of range", it in 0..255)
                }
            }
        }
    }

    @Test
    fun saturationClampsSillyInput() {
        val c = Theme.athletePalette[0]
        assertEquals(Theme.saturate(c, 1f), Theme.saturate(c, 4f))
        assertEquals(Theme.saturate(c, 0f), Theme.saturate(c, -3f))
    }

    // ---- transparency ----

    @Test
    fun opacityRunsFromOpaqueToNearlyGone() {
        assertEquals(255, Theme.panelAlpha(1f))
        val ramp = listOf(0f, 0.25f, 0.5f, 0.75f, 1f).map { Theme.panelAlpha(it) }
        ramp.zipWithNext { lo, hi -> assertTrue("alpha should rise: $ramp", hi >= lo) }
    }

    /**
     * It stops SHORT of invisible on purpose. A widget that can be made to
     * vanish entirely is one a coach cannot find to fix, and there is no
     * setting visible on a widget that isn't.
     */
    @Test
    fun glassIsStillFindable() {
        val floor = Theme.panelAlpha(0f)
        assertTrue("glass should still be faintly there, was $floor", floor in 1..80)
    }

    /**
     * The panel gets more transparent; the writing must not get harder to read.
     * Muted text lifts toward the main text colour as the panel clears.
     */
    @Test
    fun mutedTextLiftsAsThePanelClears() {
        listOf(true, false).forEach { light ->
            val text = Theme.textColor(light)
            fun gap(c: Int) =
                Math.abs(r(c) - r(text)) + Math.abs(g(c) - g(text)) + Math.abs(b(c) - b(text))

            val opaque = Theme.mutedColor(light, 1f)
            val glass = Theme.mutedColor(light, 0f)
            assertTrue(
                "muted should sit nearer the text colour on glass (light=$light)",
                gap(glass) < gap(opaque),
            )
            // And at full opacity it must be exactly today's muted colour.
            assertEquals(Theme.mutedColor(light), opaque)
        }
    }

    @Test
    fun mutedLiftIsMonotonic() {
        listOf(true, false).forEach { light ->
            val text = Theme.textColor(light)
            fun gap(c: Int) =
                Math.abs(r(c) - r(text)) + Math.abs(g(c) - g(text)) + Math.abs(b(c) - b(text))
            val gaps = listOf(1f, 0.75f, 0.5f, 0.25f, 0f).map { gap(Theme.mutedColor(light, it)) }
            gaps.zipWithNext { far, near ->
                assertTrue("muted should close on the text colour: $gaps", near <= far)
            }
        }
    }
}
