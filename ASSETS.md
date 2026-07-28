# Third-party assets

This repo is public, so anything vendored here needs its source and license
recorded. Check this file before adding a new asset, and add a row when you do.

| Asset | Location | Source | License |
|---|---|---|---|
| Barlow (6 weights) | `fonts/barlow-*.woff2` | [Google Fonts / Jeremy Tribby](https://fonts.google.com/specimen/Barlow) | SIL Open Font License 1.1 |
| Muscle-map figure paths | `ANATOMY_FIG` in `app.js` | [vulovix](https://github.com/vulovix) muscle map | Apache-2.0 |
| Exercise demo stills | `exercise-demos.js` | [free-exercise-db](https://github.com/yuhonas/free-exercise-db) | Unlicense (public domain) |
| Nav / day / program icons | inlined SVG in `app.js` | [Lucide](https://lucide.dev) | ISC |
| Food database | `food-db.js` | USDA FoodData Central | Public domain (US government work) |
| Pixel avatars | `avatars/*.png` | [Batareya — Characters 500+](https://batareya.itch.io/500-free-pixel-art-fantasy-character-pack) | Free for commercial use, modification allowed, attribution not required; redistribution as an asset pack prohibited |

## Pixel avatars

`avatars/*.png` are 32 full-body fantasy archetypes chosen from Batareya's
"Characters 500+" pack. The roster is defined by `AVATARS` in `app.js`; the
filenames are `<id>.png` and all 32 are precached by `sw.js`.

The license permits embedding in the app but **not** redistributing the pack.
Only these 32 are vendored here, which is use, not redistribution. Do not
commit the full pack.

### How they were prepared

The pack ships figures on an opaque black background at mixed resolutions
(mostly 8× nearest-neighbour upscales at 512×1024 / 512×768, but 27 files are
already native 64×96). Each chosen sprite was:

1. downscaled back to native resolution, with the upscale factor **measured per
   file** (a blanket 8× reduced the already-native files to a 4×10 smudge);
2. background removed by flood-filling black **inwards from the edges**, so the
   black outlines and shadows inside the figure survive;
3. trimmed to its bounding box;
4. centred on a 2:3 canvas sized off its own height and bottom-aligned, so
   every figure shares a ground line and fills its tile. A fixed-width canvas
   letterboxed everyone into the middle third.

The tiles use `object-fit: contain` and `image-rendering: pixelated`, so the
sprites stay at native resolution in the file and the browser scales them up
crisply.

### Swapping one out

Replace `avatars/<id>.png` (same filename, 2:3, transparent) and bump `CACHE`
in `sw.js` so installed PWAs refetch it. No code change needed.

Pick a replacement that fills its tile: measure the figure's width against the
tile's, since every figure is scaled to full height. The original wizard (#265)
covered only 20% of its tile against a ~34% roster median and read as a runt
next to the sorcerer beside it; #245 covers 40%.

Source file for each, by pack index:

| Avatar | # | Avatar | # | Avatar | # | Avatar | # |
|---|---|---|---|---|---|---|---|
| barbarian | 153 | paladin | 500 | rogue | 161 | cleric | 98 |
| berserker | 151 | templar | 20 | assassin | 399 | bard | 359 |
| knight | 149 | ranger | 385 | monk | 483 | sorcerer | 518 |
| fighter | 146 | beastmaster | 290 | druid | 445 | wizard | 245 |
| necromancer | 490 | alchemist | 441 | warlock | 426 | dragonborn | 9 |
| juggernaut | 154 | mercenary | 174 | duelist | 119 | gladiator | 199 |
| crusader | 523 | sentinel | 299 | valkyrie | 510 | scout | 10 |
| huntress | 194 | nightblade | 3 | ronin | 379 | warden | 318 |

### Packs that were also evaluated

- [aamatniekss — Bitcrawl](https://aamatniekss.itch.io/bitcrawl-creatures-characters-pixelart-asset-pack)
  — $10, 16×16 with 4-frame idle animations, commercial use allowed,
  redistribution/resale/NFT/AI-training prohibited.
- [0x72 — 16×16 DungeonTileset II](https://0x72.itch.io/dungeontileset-ii)
  — CC0, no restrictions, no attribution required.
