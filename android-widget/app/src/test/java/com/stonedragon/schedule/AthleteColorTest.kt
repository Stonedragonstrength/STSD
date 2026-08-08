package com.stonedragon.schedule

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The widget must colour an athlete exactly as the web app does, or the two
 * disagree about who is who — which is worse than no colour at all.
 *
 * The expected indices below are the OUTPUT of app.js's own athleteColorIdx()
 * run over these exact keys. Do not recompute them by reasoning about the hash:
 * if this test fails, the Kotlin port is wrong, not these numbers.
 */
class AthleteColorTest {

    @Test
    fun matchesTheWebApp() {
        // Real athlete ids from production, so a divergence shows up against
        // the people it would actually mis-colour.
        assertEquals(7, Theme.athleteColorIdx("mrbndhp2z1bfz0"))
        assertEquals(7, Theme.athleteColorIdx("mrbndmh310pmc8"))
        assertEquals(0, Theme.athleteColorIdx("mr2gagizmq3itb"))
        assertEquals(7, Theme.athleteColorIdx("a1"))
        assertEquals(3, Theme.athleteColorIdx("Leo Frostholm"))
        assertEquals(3, Theme.athleteColorIdx("Alyssa Stielstra"))
        assertEquals(5, Theme.athleteColorIdx("0"))
    }

    /**
     * djb2 seeded at 5381, so an empty key is 5381 % 8. Worth pinning: a row
     * with neither an id nor a name must still land somewhere stable rather
     * than throwing or flickering between renders.
     */
    @Test
    fun emptyKeyIsStable() {
        assertEquals(5, Theme.athleteColorIdx(""))
        assertEquals(Theme.athleteColorIdx(""), Theme.athleteColorIdx(""))
    }

    @Test
    fun everyIndexIsInThePalette() {
        listOf("a", "bb", "ccc", "", "mrbndhp2z1bfz0", "Zoë Ünïcode").forEach {
            val i = Theme.athleteColorIdx(it)
            assertTrue("index $i out of range for '$it'", i in Theme.athletePalette.indices)
        }
    }

    /** The id decides; the name is only the fallback for rows carrying no id. */
    @Test
    fun idBeatsName() {
        assertEquals(
            Theme.athletePalette[Theme.athleteColorIdx("a1")],
            Theme.athleteColor("a1", "Leo Frostholm"),
        )
        assertEquals(
            Theme.athletePalette[Theme.athleteColorIdx("Leo Frostholm")],
            Theme.athleteColor("", "Leo Frostholm"),
        )
    }

    /**
     * The palette is a POSITIONAL contract with the web app's AVATAR_COLORS —
     * the hash returns an index into it, so reordering silently re-colours the
     * whole roster.
     */
    @Test
    fun paletteIsEightInTheAppsOrder() {
        assertEquals(8, Theme.athletePalette.size)
        assertEquals(0xFF06B6D4.toInt(), Theme.athletePalette[0])
        assertEquals(0xFFF97316.toInt(), Theme.athletePalette[7])
    }
}
