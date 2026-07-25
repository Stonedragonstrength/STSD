// Build the vendored food database from USDA FoodData Central bulk JSON.
// SR Legacy (final release, public domain) + Foundation Foods (newer analyses).
// Output: food-db.js — a compact global consumed by app.js.
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "usda");
const OUT = process.argv[2] || path.join(__dirname, "food-db.js");

// Nutrient ids we keep. Energy prefers kcal (1008); some rows only carry kJ.
const N = { kcal: 1008, kj: 1062, atwaterGeneral: 2047, atwaterSpecific: 2048,
            protein: 1003, carbs: 1005, fat: 1004, fiber: 1079, sugar: 2000, sodium: 1093 };

// Categories that are noise in a lifter's food log — mostly institutional,
// infant, or raw-commodity entries nobody logs by name.
const SKIP_CATEGORIES = new Set([
  "Baby Foods",
  "American Indian/Alaska Native Foods",
]);

// Descriptions that signal an entry is a research/commodity row, not a food
// someone eats and logs.
const SKIP_DESC = /\b(baby food|infant formula|formula, |puree, |commercially prepared, unprepared|USDA Commodity|school|reduced sodium, unprepared)\b/i;

// SR Legacy descriptions carry survey bookkeeping nobody searching for dinner
// cares about. Strip the phrases that add no meaning; keep every qualifier that
// changes the food ("raw", "cooked", "lean only", "with salt").
const NOISE = [
  /, broilers or fryers\b/gi,
  /, all classes\b/gi,
  /, composite of trimmed retail cuts \([^)]*\)/gi,
  /, NS as to form\b/gi,
  /, NFS\b/gi,
  /\(includes foods for USDA'?s Food Distribution Program\)/gi,
  /, includes USDA commodity[^,]*/gi,
  /USDA Commodity,? ?/gi,
  /, formulated bar\b/gi,
  /, prepared from recipe\b/gi,
  /, unprepared\b/gi,
  /, choice grade\b/gi,
  /, select grade\b/gi,
  /, trimmed to 0" fat\b/gi,
  /, trimmed to 1\/8" fat\b/gi,
];

function cleanName(desc) {
  let s = desc;
  for (const re of NOISE) s = s.replace(re, "");
  s = s.replace(/\s*,\s*,+/g, ",").replace(/\s{2,}/g, " ").replace(/\s*,\s*$/, "").trim();
  return s;
}

function num(x) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function round(n, d) { if (n == null) return null; const m = Math.pow(10, d); return Math.round(n * m) / m; }

function nutrientMap(food) {
  const out = {};
  for (const fn of food.foodNutrients || []) {
    const id = fn.nutrient && fn.nutrient.id;
    const amt = num(fn.amount);
    if (id == null || amt == null) continue;
    if (out[id] == null) out[id] = amt;
  }
  return out;
}

// Household measures: "1 cup, chopped", "1 medium", "3 oz". Capped per food so
// the picker stays short and the file stays small.
function portions(food) {
  const seen = new Set();
  const out = [];
  for (const p of food.foodPortions || []) {
    const grams = num(p.gramWeight);
    if (!grams || grams <= 0) continue;
    const unit = (p.measureUnit && p.measureUnit.name && p.measureUnit.name !== "undetermined")
      ? p.measureUnit.name : "";
    const mod = (p.modifier || "").trim();
    const amount = num(p.amount) || 1;
    // SR Legacy often puts the real measure in `modifier` when measureUnit is
    // undetermined ("cup, chopped", "medium", "fl oz").
    let label = unit ? `${amount} ${unit}${mod ? ", " + mod : ""}` : `${amount} ${mod}`;
    label = label.replace(/\s+/g, " ").trim();
    if (!label || label === String(amount)) continue;
    if (label.length > 34) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push([label, round(grams, 1)]);
    if (out.length >= 3) break;
  }
  return out;
}

function convert(food) {
  const desc = cleanName((food.description || "").trim());
  if (!desc) return null;
  const cat = (food.foodCategory && food.foodCategory.description) || "";
  if (SKIP_CATEGORIES.has(cat)) return null;
  if (SKIP_DESC.test(desc)) return null;

  const n = nutrientMap(food);
  let kcal = n[N.kcal] != null ? n[N.kcal]
    : n[N.atwaterSpecific] != null ? n[N.atwaterSpecific]
    : n[N.atwaterGeneral] != null ? n[N.atwaterGeneral]
    : n[N.kj] != null ? n[N.kj] / 4.184
    : null;
  const protein = n[N.protein], carbs = n[N.carbs], fat = n[N.fat];
  // No energy and no macros means there is nothing to log against.
  if (kcal == null && protein == null && carbs == null && fat == null) return null;
  if (kcal == null) {
    kcal = (protein || 0) * 4 + (carbs || 0) * 4 + (fat || 0) * 9;
  }
  // Water, salt and the like are legitimately zero — keep them only if they
  // carry a real portion, otherwise they are dead search results.
  const rec = {
    i: food.fdcId,
    n: desc,
    c: cat,
    k: Math.round(kcal),
    p: round(protein || 0, 1),
    b: round(carbs || 0, 1),
    f: round(fat || 0, 1),
    r: round(n[N.fiber] || 0, 1),
  };
  const pt = portions(food);
  if (pt.length) rec.m = pt;
  return rec;
}

function load(file, key) {
  console.log("reading", path.basename(file));
  const raw = fs.readFileSync(file, "utf8");
  const json = JSON.parse(raw);
  const arr = json[key] || json.FoundationFoods || json.SRLegacyFoods || [];
  console.log("  entries:", arr.length);
  return arr;
}

const out = [];
const seenDesc = new Set();

// Foundation first: newer, better-documented analyses win on duplicate names.
for (const [file, key] of [
  [path.join(DIR, "FoodData_Central_foundation_food_json_2025-12-18.json"), "FoundationFoods"],
  [path.join(DIR, "FoodData_Central_sr_legacy_food_json_2018-04.json"), "SRLegacyFoods"],
]) {
  if (!fs.existsSync(file)) { console.warn("  missing:", file); continue; }
  for (const food of load(file, key)) {
    const rec = convert(food);
    if (!rec) continue;
    const dk = rec.n.toLowerCase();
    if (seenDesc.has(dk)) continue;
    seenDesc.add(dk);
    out.push(rec);
  }
}

out.sort((a, b) => a.n.localeCompare(b.n));
console.log("total foods:", out.length);

// Category strings repeat heavily — intern them into a lookup table.
const cats = [];
const catIndex = new Map();
for (const r of out) {
  if (!catIndex.has(r.c)) { catIndex.set(r.c, cats.length); cats.push(r.c); }
  r.c = catIndex.get(r.c);
}

const payload = {
  version: "usda-2026-07",
  categories: cats,
  // [ id, name, catIndex, kcal, protein, carbs, fat, fiber, portions? ]
  foods: out.map((r) => {
    const row = [r.i, r.n, r.c, r.k, r.p, r.b, r.f, r.r];
    if (r.m) row.push(r.m);
    return row;
  }),
};

const banner = `// Vendored food database — USDA FoodData Central (public domain).
// Foundation Foods 2025-12-18 + SR Legacy 2018-04, trimmed to the fields the
// food logger needs. Values are per 100 g. Generated, do not hand-edit.
// Row: [fdcId, name, categoryIndex, kcal, protein, carbs, fat, fiber, source, portions?]
//   source: 1 = Foundation, 0 = SR Legacy.  portions: [[label, grams], ...]
// See ATTRIBUTIONS.md. Regenerate with scripts/build-food-db.js.
`;
fs.writeFileSync(OUT, banner + "window.FOOD_DB = " + JSON.stringify(payload) + ";\n");
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log("wrote", OUT, kb + " KB");
console.log("categories:", cats.length);
console.log("with portions:", out.filter((r) => r.m).length);
