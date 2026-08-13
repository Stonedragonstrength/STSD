// Template deletion tombstones — why deleting a program has to leave a trace.
//
// The bug this pins: deleting a template used to filter it out of the local
// array and rely on a debounced (1.5s) push to tell the cloud. On the phone
// that push routinely dies — a reload or the PWA being backgrounded kills the
// timer/fetch — so the cloud still holds the template. The next pull runs
// mergeById, which reads a cloud-only id as "created on another device" and
// resurrects it; the boot-time dirty-flag re-push then writes the resurrected
// array back to the cloud, permanently undoing the delete. Deleting on the
// phone and pull-to-refreshing brought "Untitled Program" back every time.
//
// The fix: delete writes a STAMPED TOMBSTONE ({id, name, deleted, updatedAt})
// in place of the entry. mergeById needs no change — the tombstone is just the
// newest version of that id, so newest-wins carries the deletion through every
// merge path, and whichever push eventually lands records it in the cloud.
// Render paths read through liveTemplates(); boot purges tombstones after 30
// days, by which time every device has synced past them.
//
// These run the REAL functions, extracted from app.js by brace-matching.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function fnSrc(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`not found: ${decl}`);
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error(`unbalanced: ${decl}`);
}

const extract = (decl, name) =>
  new Function(`${fnSrc(appSrc, decl)}; return ${name};`)();

const mergeById = extract("function mergeById(", "mergeById");
const deleteTemplateById = extract("function deleteTemplateById(", "deleteTemplateById");
const liveTemplates = extract("function liveTemplates(", "liveTemplates");
const purgeTemplateTombstones = extract("function purgeTemplateTombstones(", "purgeTemplateTombstones");

let failures = 0;
function check(label, fn) {
  try { fn(); console.log(`  ok   ${label}`); }
  catch (e) { failures++; console.log(`  FAIL ${label}\n       ${e.message}`); }
}

const DAY = 24 * 60 * 60 * 1000;
const tpl = (id, updatedAt, name) => ({ id, name: name || id, updatedAt, weeks: [] });

console.log("\ntemplate tombstones");

check("the mechanism being fixed: a plain removal is resurrected by the dirty-pull merge", () => {
  // Old delete: filter the array. Local no longer holds the id at all, so the
  // merge cannot tell "deleted here" from "created elsewhere" — the cloud copy
  // comes back. This is mergeById working as designed; it is why delete must
  // tombstone instead.
  const cloud = [tpl("a", 1000, "Untitled Program")];
  const localAfterFilterDelete = [];
  const merged = mergeById(cloud, localAfterFilterDelete);
  assert.strictEqual(merged.length, 1, "cloud copy resurrected");
  assert.strictEqual(merged[0].id, "a");
});

check("deleteTemplateById replaces the entry with a stamped tombstone, others untouched", () => {
  const list = [tpl("a", 1000, "Untitled Program"), tpl("b", 2000, "GPP Block")];
  const out = deleteTemplateById(list, "a");
  assert.strictEqual(out.length, 2, "tombstone stays in the array");
  const dead = out.find((t) => t.id === "a");
  assert.strictEqual(dead.deleted, true);
  assert.ok(Number(dead.updatedAt) > 1000, "tombstone is stamped now");
  assert.ok(!("weeks" in dead), "tombstone carries no program body");
  assert.deepStrictEqual(out.find((t) => t.id === "b"), list[1], "other entries untouched");
});

check("the phone repro: tombstone survives the dirty-pull merge, liveTemplates hides it", () => {
  // Delete on the phone, reload before the push lands. Cloud still has the
  // live copy; local holds the tombstone. Boot pulls with the dirty-flag
  // options (prefer local, keep local-only) — the tombstone's newer stamp
  // must win, and the re-push then carries the deletion up.
  const cloud = [tpl("a", 1000, "Untitled Program")];
  const local = deleteTemplateById([tpl("a", 1000, "Untitled Program")], "a");
  const merged = mergeById(cloud, local);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].deleted, true, "deletion survives the pull");
  assert.deepStrictEqual(liveTemplates(merged), [], "nothing renders");
});

check("tombstone also survives the clean-pull merge (prefer cloud, drop local-only)", () => {
  const cloud = [tpl("a", 1000, "Untitled Program")];
  const local = deleteTemplateById([tpl("a", 1000, "Untitled Program")], "a");
  const merged = mergeById(cloud, local, { prefer: "cloud", keepLocalOnly: false });
  assert.strictEqual(merged[0].deleted, true, "self-heal path sees the deletion and re-pushes it");
});

check("an edit stamped after the delete wins — latest action rules, both directions", () => {
  const t = Date.now();
  const localTombstone = { id: "a", name: "Block", deleted: true, updatedAt: t - 1000 };
  const cloudEditedLater = { ...tpl("a", t, "Block"), weeks: [{ id: "w1" }] };
  const merged = mergeById([cloudEditedLater], [localTombstone]);
  assert.ok(!merged[0].deleted, "newer edit on another device undoes the older delete");
  const cloudTombstone = { id: "a", name: "Block", deleted: true, updatedAt: t };
  const localEditedEarlier = { ...tpl("a", t - 1000, "Block") };
  const merged2 = mergeById([cloudTombstone], [localEditedEarlier]);
  assert.strictEqual(merged2[0].deleted, true, "newer delete beats the older edit");
});

check("deletion already in the cloud: a clean pull drops the stale local copy", () => {
  // Device B slept through the delete. Cloud carries the tombstone; B's live
  // copy is older, so the tombstone wins and B stops showing the program.
  const t = Date.now();
  const cloud = [{ id: "a", name: "Untitled Program", deleted: true, updatedAt: t }];
  const local = [tpl("a", t - DAY, "Untitled Program")];
  const merged = mergeById(cloud, local, { prefer: "cloud", keepLocalOnly: false });
  assert.strictEqual(merged[0].deleted, true);
  assert.deepStrictEqual(liveTemplates(merged), []);
});

check("purge drops only expired tombstones — live entries and fresh tombstones stay", () => {
  const t = Date.now();
  const list = [
    tpl("live", 500, "Keeper"),
    { id: "old", name: "Gone", deleted: true, updatedAt: t - 31 * DAY },
    { id: "fresh", name: "Just deleted", deleted: true, updatedAt: t - DAY },
  ];
  const out = purgeTemplateTombstones(list);
  assert.deepStrictEqual(out.map((x) => x.id), ["live", "fresh"]);
});

check("helpers tolerate a missing list", () => {
  assert.deepStrictEqual(liveTemplates(null), []);
  assert.deepStrictEqual(purgeTemplateTombstones(undefined), []);
  assert.deepStrictEqual(deleteTemplateById(null, "a"), []);
});

console.log("");
if (failures) { console.log(`${failures} failing`); process.exit(1); }
console.log("all passing");
