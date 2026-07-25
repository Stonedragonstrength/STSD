# Third-party attributions

## free-exercise-db (exercise demo photos)

The "See how" exercise demos use photos and metadata from **free-exercise-db**.

- Source: https://github.com/yuhonas/free-exercise-db
- License: The Unlicense (public domain) — https://unlicense.org/

The photos are loaded from the jsDelivr CDN
(`https://cdn.jsdelivr.net/gh/yuhonas/free-exercise-db@main/exercises/<id>/<n>.jpg`)
rather than vendored, to keep the repo small. Only the lookup metadata (id,
name, image count, equipment, muscles, level, category) is vendored, in
`exercise-demos.js`. Regenerate it from `dist/exercises.json` in that repo when
the dataset updates.

## USDA FoodData Central (food logger database)

The food logger's searchable food list comes from **USDA FoodData Central**.

- Source: https://fdc.nal.usda.gov/download-datasets
- Datasets: Foundation Foods (2025-12-18) and SR Legacy (2018-04, final release)
- License: public domain (a work of the U.S. federal government, 17 U.S.C. § 105)

The data is vendored in `food-db.js` rather than fetched at runtime, so search
works offline and needs no API key. Only the fields the logger uses are kept
(name, category, calories, protein, carbs, fat, fiber per 100 g, and up to three
household portions), and USDA survey bookkeeping is stripped from the names.
Regenerate with `scripts/build-food-db.js` after downloading the bulk JSON.

## Body Muscles (anatomy muscle-map SVG paths)

The Anatomy Library's front/back muscle-map figure uses SVG path data adapted
from **Body Muscles** by Ivan Vulović.

- Source: https://github.com/vulovix/body-muscles
- License: Apache License 2.0 — https://www.apache.org/licenses/LICENSE-2.0

NOTICE:

> Body Muscles
> Copyright 2024 Ivan Vulović
>
> This product includes software developed by Ivan Vulović.
> https://github.com/vulovix/body-muscles

Changes made: the fine-grained per-side muscle regions were grouped into Stone
Dragon's coarser muscle groups, and non-muscle parts (head, hands, feet, joints,
spine) were reassigned as the non-interactive body backdrop. The generated data
lives in `app.js` as `ANATOMY_FIG`.
