// Branded-food text search, proxied to USDA FoodData Central.
//
// The key lives ONLY in this function's secrets (USDA_API_KEY). USDA issues
// data.gov keys as confidential, so it must never reach config.js or any
// client bundle — this repo is public and every file in it ships to athletes'
// browsers in plaintext. Same reasoning as the VAPID private key in send-push.
//
// Also normalises the response: USDA reports Branded nutrients per 100 g,
// keyed by nutrientNumber, wrapped in a large payload. We map the four we use
// and drop the rest, so the client stays small and never has to know the
// USDA schema.
//
// Set the secret with:
//   supabase secrets set USDA_API_KEY=...

const SEARCH_URL = "https://api.nal.usda.gov/fdc/v1/foods/search";
const PAGE_SIZE = 25;
// USDA nutrientNumber codes. These are stable identifiers, not array indexes.
const N_KCAL = "208", N_PROTEIN = "203", N_FAT = "204", N_CARBS = "205";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const round1 = (v: unknown) => Math.round((Number(v) || 0) * 10) / 10;

function nutrient(food: any, number: string): number {
  const hit = (food.foodNutrients ?? []).find(
    (n: any) => String(n.nutrientNumber) === number,
  );
  return hit ? Number(hit.value) || 0 : 0;
}

function normalise(food: any) {
  const kcal = nutrient(food, N_KCAL);
  if (!kcal) return null; // no energy figure = useless for logging
  const brand = String(food.brandName ?? food.brandOwner ?? "").trim();
  const name = [String(food.description ?? "").trim(), brand]
    .filter(Boolean).join(" · ").slice(0, 90);
  // Only a gram serving is usable as a portion unit; anything else falls back
  // to 100 g on the client.
  const grams = String(food.servingSizeUnit ?? "").toUpperCase() === "GRM"
    ? Number(food.servingSize) || 0
    : 0;
  return {
    fdcId: food.fdcId,
    name,
    kcal: Math.round(kcal),
    p: round1(nutrient(food, N_PROTEIN)),
    c: round1(nutrient(food, N_CARBS)),
    f: round1(nutrient(food, N_FAT)),
    servingG: grams,
    servingLabel: grams
      ? (String(food.householdServingFullText ?? "").trim() || `${grams} g`)
      : "100 g",
  };
}

Deno.serve(async (req) => {
  try {
    const apiKey = Deno.env.get("USDA_API_KEY");
    if (!apiKey) {
      console.error("[food-search] USDA_API_KEY is not set");
      return json({ ok: false, error: "not configured" }, 503);
    }

    let q = "";
    try {
      const body = await req.json();
      q = String(body?.q ?? "").trim();
    } catch {
      // Missing or unparseable body — handled by the length check below.
    }
    if (q.length < 2) return json({ ok: false, error: "query too short" }, 400);

    const url = `${SEARCH_URL}?api_key=${encodeURIComponent(apiKey)}`
      + `&query=${encodeURIComponent(q.slice(0, 100))}`
      + `&dataType=Branded&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) {
      // Never echo the upstream body — the request URL carries the key and
      // USDA's error text can include it.
      console.error(`[food-search] usda ${res.status}`);
      return json({ ok: false, error: `upstream ${res.status}` }, 502);
    }
    const data = await res.json();
    const foods = (data?.foods ?? []).map(normalise).filter(Boolean);
    return json({ ok: true, foods });
  } catch (e) {
    console.error("[food-search] fatal:", e);
    return json({ ok: false, error: "search failed" }, 500);
  }
});
