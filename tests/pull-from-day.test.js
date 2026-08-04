// Slices the pull-commit loop and groupSupersets out of app.js and runs them
// in Node, so the superset remap is checked by assertion rather than by eye.
let n = 0;
const uid = () => "u" + (++n);
const makeExercise = () => ({ id: uid(), name: "", kind: "strength", timed: false, sets: "3", currentWeight: "", currentReps: "", notes: "", modifiers: [] });

// --- verbatim from app.js (groupSupersets) ---
function groupSupersets(exercises) {
  const groups = [];
  exercises.forEach((ex) => {
    const last = groups[groups.length - 1];
    if (ex.supersetId && last && last.id === ex.supersetId) last.items.push(ex);
    else groups.push({ id: ex.supersetId || null, items: [ex] });
  });
  return groups;
}

// --- the commit loop from openPullFromDayModal ---
// `cap` is opts.cap: the athlete's own sessions cap at MAX_OWN_EXERCISES, the
// coach's days are uncapped. Returns { added, skipped } so the cap tests can
// assert on the overflow the toast reports.
function commit(day, sources, picked, cap) {
  let added = 0;
  let room = cap ? cap - day.exercises.length : Infinity;
  let skipped = 0;
  sources.forEach((s) => {
    const take = (s.exercises || []).filter((ex) => picked.has(`${s.id}::${ex.id}`));
    const runN = {};
    take.forEach((ex) => { if (ex.supersetId) runN[ex.supersetId] = (runN[ex.supersetId] || 0) + 1; });
    const remap = {};
    take.forEach((ex) => {
      if (room <= 0) { skipped++; return; }
      const copy = { ...makeExercise(), ...structuredClone(ex), id: uid() };
      if (ex.supersetId && runN[ex.supersetId] > 1) {
        remap[ex.supersetId] = remap[ex.supersetId] || uid();
        copy.supersetId = remap[ex.supersetId];
      } else {
        delete copy.supersetId;
      }
      day.exercises.push(copy);
      added++; room--;
    });
  });
  return { added, skipped };
}

let pass = 0, fail = 0;
const ok = (label, cond) => { if (cond) { pass++; console.log("  PASS " + label); } else { fail++; console.log("  FAIL " + label); } };

const ex = (id, name, extra) => ({ ...makeExercise(), id, name, ...(extra || {}) });

// ---- 1. a whole superset run pulled together stays one run, with a NEW id ----
{
  const src = { id: "sA", exercises: [
    ex("a1", "Bench", { supersetId: "ssA" }),
    ex("a2", "Row",   { supersetId: "ssA" }),
    ex("a3", "Curl"),
  ] };
  const day = { exercises: [] };
  commit(day, [src], new Set(["sA::a1", "sA::a2"]));
  const g = groupSupersets(day.exercises);
  ok("both members land", day.exercises.length === 2);
  ok("they group as ONE superset", g.length === 1 && g[0].items.length === 2);
  ok("the id is minted fresh", day.exercises[0].supersetId !== "ssA");
  ok("both share the new id", day.exercises[0].supersetId === day.exercises[1].supersetId);
}

// ---- 2. HALF a run pulled comes across unlinked ----
{
  const src = { id: "sA", exercises: [
    ex("a1", "Bench", { supersetId: "ssA" }),
    ex("a2", "Row",   { supersetId: "ssA" }),
  ] };
  const day = { exercises: [] };
  commit(day, [src], new Set(["sA::a1"]));
  ok("one lift lands", day.exercises.length === 1);
  ok("its superset link is stripped", day.exercises[0].supersetId === undefined);
  ok("it stands alone", groupSupersets(day.exercises).length === 1);
}

// ---- 3. two runs from two DIFFERENT days must not merge ----
{
  const srcA = { id: "sA", exercises: [ex("a1", "Bench", { supersetId: "ss" }), ex("a2", "Row", { supersetId: "ss" })] };
  const srcB = { id: "sB", exercises: [ex("b1", "Squat", { supersetId: "ss" }), ex("b2", "RDL", { supersetId: "ss" })] };
  const day = { exercises: [] };
  commit(day, [srcA, srcB], new Set(["sA::a1", "sA::a2", "sB::b1", "sB::b2"]));
  const g = groupSupersets(day.exercises);
  ok("all four land", day.exercises.length === 4);
  ok("they stay TWO runs, not one", g.length === 2 && g[0].items.length === 2 && g[1].items.length === 2);
  ok("the two runs have different ids", g[0].id !== g[1].id);
}

// ---- 4. a pulled run can't collide with one already in the destination ----
{
  const day = { exercises: [ex("d1", "Press", { supersetId: "ss" }), ex("d2", "Pulldown", { supersetId: "ss" })] };
  const src = { id: "sA", exercises: [ex("a1", "Bench", { supersetId: "ss" }), ex("a2", "Row", { supersetId: "ss" })] };
  commit(day, [src], new Set(["sA::a1", "sA::a2"]));
  const g = groupSupersets(day.exercises);
  ok("destination run survives separately", g.length === 2);
  ok("nothing absorbed the other", g.every((x) => x.items.length === 2));
}

// ---- 5. arrays are DEEP copied, so editing the copy can't touch the source ----
{
  const source = ex("a1", "Bench", { modifiers: ["amrap"], setWeights: ["135", "155"] });
  const src = { id: "sA", exercises: [source] };
  const day = { exercises: [] };
  commit(day, [src], new Set(["sA::a1"]));
  const copy = day.exercises[0];
  copy.modifiers.push("tempo");
  copy.setWeights[0] = "999";
  ok("modifiers are not shared", source.modifiers.length === 1);
  ok("per-set weights are not shared", source.setWeights[0] === "135");
  ok("the copy got a new id", copy.id !== "a1");
  ok("the numbers came across", copy.setWeights[1] === "155");
}

// ---- 6. nothing ticked = nothing added ----
{
  const src = { id: "sA", exercises: [ex("a1", "Bench")] };
  const day = { exercises: [] };
  const r = commit(day, [src], new Set());
  ok("empty selection adds nothing", r.added === 0 && day.exercises.length === 0);
}

// ---- 7. order within a source is preserved ----
{
  const src = { id: "sA", exercises: [ex("a1", "One"), ex("a2", "Two"), ex("a3", "Three")] };
  const day = { exercises: [] };
  commit(day, [src], new Set(["sA::a3", "sA::a1"]));
  ok("picks land in source order, not tick order",
    day.exercises.map((e) => e.name).join(",") === "One,Three");
}

// ---- 8. the cap (athlete's own sessions) takes what fits ----
// A pull that overflows must not silently exceed the cap, and must not throw
// the whole selection away either — the athlete gets what fit and is told what
// didn't, so a 3-lift pull into a session with 2 slots left is not a no-op.
console.log("\n-- the athlete session cap --");
{
  const src = { id: "sA", exercises: [ex("a1", "One"), ex("a2", "Two"), ex("a3", "Three")] };
  const day = { exercises: [] };
  const r = commit(day, [src], new Set(["sA::a1", "sA::a2", "sA::a3"]), 2);
  ok("only what fits lands", day.exercises.length === 2);
  ok("added counts the ones that landed", r.added === 2);
  ok("skipped counts the overflow", r.skipped === 1);
  ok("the ones that fit are the first picked", day.exercises.map((e) => e.name).join(",") === "One,Two");
}
{
  // Room is measured from what's ALREADY in the day, not from the cap.
  const src = { id: "sA", exercises: [ex("a1", "One"), ex("a2", "Two")] };
  const day = { exercises: [ex("x1", "Existing")] };
  const r = commit(day, [src], new Set(["sA::a1", "sA::a2"]), 2);
  ok("a part-full day only takes its remaining room", day.exercises.length === 2);
  ok("and reports the rest as skipped", r.added === 1 && r.skipped === 1);
}
{
  // A full day skips everything rather than adding a 13th lift.
  const src = { id: "sA", exercises: [ex("a1", "One")] };
  const day = { exercises: [ex("x1", "A"), ex("x2", "B")] };
  const r = commit(day, [src], new Set(["sA::a1"]), 2);
  ok("a full day takes nothing", day.exercises.length === 2 && r.added === 0 && r.skipped === 1);
}
{
  // The coach path passes no cap and must stay unbounded.
  const src = { id: "sA", exercises: Array.from({ length: 30 }, (_, i) => ex("a" + i, "Ex" + i)) };
  const day = { exercises: [] };
  const r = commit(day, [src], new Set(src.exercises.map((e) => "sA::" + e.id)));
  ok("no cap means no limit", day.exercises.length === 30 && r.skipped === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
