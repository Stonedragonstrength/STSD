// The Programs page's third bucket — where a program goes once it's been
// handed to an athlete.
//
// Two decisions in here fail silently if they get "tidied up", which is the
// only reason this file exists. Nothing throws either way; the list is just
// quietly wrong on a screen the coach trusts.
//
// 1. "In use" is a separate `assignedAt` field, NOT a third `status` value.
//    ensureProgramTemplates() resets any status it doesn't recognise back to
//    "draft" — so on a phone running a build older than this one, a third
//    status would drag every handed-out program back into the build list and
//    push that back to the cloud. An unknown FIELD rides through untouched.
//
// 2. The boot backfill tests `"assignedAt" in p`, not `p.assignedAt`. The
//    row's "↩ Ready" button writes `assignedAt = null` rather than deleting
//    the key, precisely so the program stays put. Swap the check for a
//    truthiness test and the button appears to work, then undoes itself on the
//    next boot — and on a second device that never ran the migration, the
//    moment it syncs.
//
// Both run the REAL code, extracted from app.js by brace-matching, so a change
// to the original fails here instead of leaving a copy to rot.

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

function braceBlock(src, at) {
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (!depth) return src.slice(at, i + 1); }
  }
  throw new Error(`unbalanced from ${at}`);
}

function fnSrc(decl) {
  const at = appSrc.indexOf(decl);
  if (at < 0) throw new Error(`not found: ${decl}`);
  return braceBlock(appSrc, at);
}

const programBucket = new Function(`${fnSrc("function programBucket(")}; return programBucket;`)();

// The backfill is a bare forEach inside the boot migration, not a named
// function, so pull it out by its opening line and run it against a fake state.
const BACKFILL_HEAD = "(state.trainerData.programTemplates || []).forEach((p) => {";
const backfillAt = appSrc.indexOf(BACKFILL_HEAD);
assert.ok(backfillAt > -1, "boot backfill not found — did its shape change?");
const backfillSrc = appSrc.slice(backfillAt, appSrc.indexOf("});", backfillAt) + 3);

function runBackfill(trainerData) {
  let _trainerDataDirty = false;
  const state = { trainerData };
  new Function("state", `let _trainerDataDirty = false; ${backfillSrc}; return _trainerDataDirty;`)(state);
  // Re-run to confirm the guard, not just the first pass.
  return trainerData;
}

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

// ---------------------------------------------------------------- buckets --
console.log("programBucket");

ok("a draft is in progress however it is stamped", () => {
  assert.strictEqual(programBucket({ status: "draft" }), "progress");
  assert.strictEqual(programBucket({}), "progress");
  // Even carrying an assignedAt: a program pulled back to draft is being
  // rebuilt, and belongs with the things being built.
  assert.strictEqual(programBucket({ status: "draft", assignedAt: 123 }), "progress");
});

ok("ready and never handed out is Ready", () => {
  assert.strictEqual(programBucket({ status: "ready" }), "ready");
});

ok("ready and handed out is In use", () => {
  assert.strictEqual(programBucket({ status: "ready", assignedAt: 1700000000000 }), "inuse");
});

ok("un-shelved (assignedAt null) reads as Ready, not In use", () => {
  // This is what "↩ Ready" writes. If it read as inuse the button would do
  // nothing visible; if the key were deleted the backfill would re-stamp it.
  assert.strictEqual(programBucket({ status: "ready", assignedAt: null }), "ready");
});

ok("status carries only two values, so an old build cannot demote a shelf", () => {
  // The guard on decision 1. If a future edit moves "in use" into `status`,
  // this fails and the reason is in the header comment.
  const bucketSrc = fnSrc("function programBucket(");
  assert.ok(/status !== "ready"/.test(bucketSrc), "bucket no longer keys off status !== ready");
  assert.ok(/assignedAt/.test(bucketSrc), "bucket no longer reads assignedAt");
  assert.ok(!/status === "inuse"|status === "assigned"/.test(bucketSrc),
    'in-use moved into `status` — an older build resets unknown statuses to "draft"');
});

// --------------------------------------------------------------- backfill --
console.log("boot backfill");

const linked = (id) => ({ id: "c1", name: "Marcus", assignedProgramId: id });

ok("a program already live on an athlete lands In use", () => {
  const td = {
    programTemplates: [{ id: "p1", status: "ready", updatedAt: 111, createdAt: 1 }],
    clients: [linked("p1")],
  };
  runBackfill(td);
  const p = td.programTemplates[0];
  assert.strictEqual(programBucket(p), "inuse");
  assert.strictEqual(p.assignedTo, "Marcus", "who it went to is snapshotted");
});

ok("it is dated from the program's own last edit, not today", () => {
  // A library of old assignments must not read as if it was all handed out
  // this morning — the date is the only thing separating them on the row.
  const td = {
    programTemplates: [{ id: "p1", status: "ready", updatedAt: 111, createdAt: 5 }],
    clients: [linked("p1")],
  };
  runBackfill(td);
  assert.strictEqual(td.programTemplates[0].assignedAt, 111);
});

ok("createdAt is the fallback when a program was never edited", () => {
  const td = {
    programTemplates: [{ id: "p1", status: "ready", createdAt: 5 }],
    clients: [linked("p1")],
  };
  runBackfill(td);
  assert.strictEqual(td.programTemplates[0].assignedAt, 5);
});

ok("a program nobody is on is left alone", () => {
  const td = {
    programTemplates: [{ id: "p1", status: "ready", updatedAt: 111 }],
    clients: [{ id: "c1", name: "Dana" }],
  };
  runBackfill(td);
  assert.ok(!("assignedAt" in td.programTemplates[0]), "never-assigned program got stamped");
  assert.strictEqual(programBucket(td.programTemplates[0]), "ready");
});

ok("a tombstone is never stamped", () => {
  // Tombstones ride the array through sync carrying nothing but id/deleted/
  // updatedAt (see template-tombstones.test.js). Stamping one would put a
  // deleted program on the shelf.
  const td = {
    programTemplates: [{ id: "p1", deleted: true, updatedAt: 111 }],
    clients: [linked("p1")],
  };
  runBackfill(td);
  assert.ok(!("assignedAt" in td.programTemplates[0]));
});

ok("↩ Ready survives the next boot — the whole point of `in`", () => {
  // The coach shelved it, then put it back. It is still live on Marcus, so a
  // truthiness check would re-stamp it here and silently undo the button.
  const td = {
    programTemplates: [{ id: "p1", status: "ready", assignedAt: null, assignedTo: "Marcus", updatedAt: 111 }],
    clients: [linked("p1")],
  };
  runBackfill(td);
  assert.strictEqual(td.programTemplates[0].assignedAt, null,
    "backfill re-stamped an explicitly un-shelved program — use `\"assignedAt\" in p`, not `p.assignedAt`");
  assert.strictEqual(programBucket(td.programTemplates[0]), "ready");
});

ok("the backfill is idempotent across repeated boots", () => {
  const td = {
    programTemplates: [{ id: "p1", status: "ready", updatedAt: 111 }],
    clients: [linked("p1")],
  };
  runBackfill(td);
  const first = td.programTemplates[0].assignedAt;
  runBackfill(td);
  runBackfill(td);
  assert.strictEqual(td.programTemplates[0].assignedAt, first, "date moved on a later boot");
});

ok("an empty roster does not throw", () => {
  const td = { programTemplates: [{ id: "p1", status: "ready" }] };
  runBackfill(td);
  assert.ok(!("assignedAt" in td.programTemplates[0]));
});

// ------------------------------------------------------------------ chips --
console.log("chip wiring");

ok("every bucket programBucket can return has a chip", () => {
  // A bucket with no chip is a program that exists and is unreachable from
  // the page: renderProgramsList indexes buckets[] by chip key.
  const at = appSrc.indexOf("const PROGRAM_CHIPS = [");
  assert.ok(at > -1, "PROGRAM_CHIPS not found");
  const chipsSrc = appSrc.slice(at, appSrc.indexOf("];", at));
  const keys = [...chipsSrc.matchAll(/key: "(\w+)"/g)].map((m) => m[1]);
  ["progress", "ready", "inuse"].forEach((k) =>
    assert.ok(keys.includes(k), `no chip renders the "${k}" bucket`));
});

ok("assign stamps the program, not just the athlete", () => {
  // The gap this feature closes: assigning used to stamp assignedProgramId on
  // the client and nothing at all on the program, so it sat in Ready forever.
  const assignSrc = braceBlock(appSrc, appSrc.indexOf("const doAssign = (archiveFirst) =>"));
  assert.ok(/client\.assignedProgramId = tpl\.id/.test(assignSrc), "athlete no longer linked");
  assert.ok(/tpl\.assignedAt = Date\.now\(\)/.test(assignSrc), "assign stopped shelving the program");
  assert.ok(/tpl\.assignedTo = client\.name/.test(assignSrc), "assign stopped snapshotting who got it");
});

console.log(`\n${passed} passed`);
