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
        // The top of the range is 2 now, not 1 — see the darkening half.
        assertEquals(Theme.saturate(c, 2f), Theme.saturate(c, 4f))
        assertEquals(Theme.saturate(c, 0f), Theme.saturate(c, -3f))
    }

    // ---- the darkening half (slider past the middle) ----

    /** Rec. 601 luma — the same weights saturate() itself mixes with. */
    private fun luma(c: Int) = 0.299f * r(c) + 0.587f * g(c) + 0.114f * b(c)

    @Test
    fun darkeningIsMonotonicAndNeverReachesBlack() {
        Theme.athletePalette.forEach { colour ->
            val steps = listOf(1f, 1.25f, 1.5f, 1.75f, 2f).map { luma(Theme.saturate(colour, it)) }
            steps.zipWithNext { hi, lo ->
                assertTrue("luma should only fall past the middle: $steps", lo <= hi)
            }
            // 65% is the floor by design: text and athlete edges ride this same
            // curve, and a slider that can push them to black can erase them.
            assertTrue(
                "darkest stop should keep ~35% of the colour: ${steps.last()} vs ${steps.first()}",
                steps.last() > steps.first() * 0.30f,
            )
        }
    }

    @Test
    fun darkeningNeverReordersTheChannels() {
        Theme.athletePalette.forEach { colour ->
            val before = order(colour)
            listOf(1.3f, 1.7f, 2f).forEach { amt ->
                assertEquals("hue moved at $amt", before, order(Theme.saturate(colour, amt)))
            }
        }
    }

    @Test
    fun darkeningKeepsAlpha() {
        val c = 0xCC3DFF77.toInt()
        listOf(1.4f, 2f).forEach { assertEquals(a(c), a(Theme.saturate(c, it))) }
    }

    // ---- tone: the accent's own journey ----

    @Test
    fun toneMatchesSaturateBelowTheMiddle() {
        Theme.ACCENTS.forEach { acc ->
            listOf(0f, 0.4f, 1f).forEach { amt ->
                assertEquals(Theme.saturate(acc.neon, amt), Theme.tone(acc.neon, acc.deep, amt))
            }
        }
    }

    @Test
    fun toneCrossesExactlyThroughTheDeepTwin() {
        // 1.5 IS the deep colour: the first darker stretch is a crossfade to the
        // curated twin, not a dimmer — that is the whole point of option C.
        Theme.ACCENTS.forEach { acc ->
            assertEquals(acc.deep, Theme.tone(acc.neon, acc.deep, 1.5f))
        }
    }

    @Test
    fun toneEndsDarkerThanTheDeepTwin() {
        Theme.ACCENTS.forEach { acc ->
            val end = Theme.tone(acc.neon, acc.deep, 2f)
            assertTrue(
                "${acc.id} should end below its deep twin",
                luma(end) < luma(acc.deep),
            )
        }
    }

    @Test
    fun toneOnTheLightSurfaceHasNoDeadZone() {
        // base == deep (the light surface): the top half must still move, as one
        // long darken — a stretch of slider that does nothing reads as broken.
        Theme.ACCENTS.forEach { acc ->
            val lumas = listOf(1f, 1.25f, 1.5f, 1.75f, 2f)
                .map { luma(Theme.tone(acc.deep, acc.deep, it)) }
            lumas.zipWithNext { hi, lo ->
                assertTrue("${acc.id} light-surface tone stalled: $lumas", lo < hi)
            }
        }
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
