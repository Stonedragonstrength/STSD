// Closing time off: what a block subtracts from the bookable day.
//
// This is the only rule in the app that makes a slot disappear for BOTH sides
// at once — the coach's quick-picks and the athlete's grid are the same
// `generateSlots` call — so an off-by-one here either hands out a session the
// coach is not there for, or quietly deletes a working afternoon. Neither
// shows up as an error.
//
// The case that earns the test most is the mirror. `blackouts` used to be the
// only way to say "day off"; it is now DERIVED from the all-day blocks and
// written purely for athletes on a cached PWA running the previous build.
// Derive it wrong and the two disagree, which is invisible on this build and
// wrong on theirs.
//
// DUPLICATES blockDates(), the block half of normalizeAvailability(), the
// blackout/busy folding in generateSlots(), and the mirror rebuild in
// saveCoachAvailability() (app.js — one IIFE, no exports). Change the original
// and change these, or this guards nothing.

// parseHM is the REAL one, required from the extracted module (Phase 4).
require(require("path").join(__dirname, "..", "src", "scheduling", "zone.js"));
const { parseHM } = globalThis.STSD.scheduling;
const p2 = (n) => String(n).padStart(2, "0");
const dateISO = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

function blockDates(b) {
  const out = [];
  const d = new Date(b.date + "T12:00:00");
  const end = new Date((b.endDate || b.date) + "T12:00:00");
  for (let i = 0; i < 400 && +d <= +end; i++) {
    out.push(dateISO(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function normalizeBlocks(av) {
  const blackouts = Array.isArray(av.blackouts) ? av.blackouts : [];
  const blocks = (Array.isArray(av.blocks) ? av.blocks : [])
    .filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(b.date))
    .map((b) => ({
      id: b.id || "x",
      date: b.date,
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(b.endDate) && b.endDate > b.date ? b.endDate : b.date,
      allDay: !!b.allDay || !parseHM(b.start) || !parseHM(b.end) || !(b.end > b.start),
      start: b.start || "",
      end: b.end || "",
      label: String(b.label || "").slice(0, 60),
    }));
  const covered = new Set();
  blocks.forEach((b) => { if (b.allDay) blockDates(b).forEach((d) => covered.add(d)); });
  blackouts.forEach((d) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || covered.has(d)) return;
    covered.add(d);
    blocks.push({ id: `bo_${d}`, date: d, endDate: d, allDay: true, start: "", end: "", label: "" });
  });
  return { blackouts, blocks };
}

// The blackouts mirror, as saveCoachAvailability rebuilds it.
function mirrorBlackouts(blocks) {
  const off = new Set();
  blocks.forEach((b) => { if (b.allDay) blockDates(b).forEach((d) => off.add(d)); });
  return [...off].sort();
}

// Slot generation, reduced to the parts blocks touch. Fixed UTC so the test
// says the same thing on any machine — the zone maths has its own coverage.
function generateSlots(av, days) {
  const a = { sessionMins: 60, bufferMins: 0, weekly: {}, extra: [], ...av };
  const { blocks } = normalizeBlocks(a);
  const lenMs = a.sessionMins * 60000;
  const stepMs = (a.sessionMins + a.bufferMins) * 60000;
  const blackouts = new Set(Array.isArray(a.blackouts) ? a.blackouts : []);
  blocks.forEach((b) => { if (b.allDay) blockDates(b).forEach((d) => blackouts.add(d)); });

  const out = [];
  days.forEach((dayISO) => {
    if (blackouts.has(dayISO)) return;
    const [y, m, d] = dayISO.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
    (a.weekly[String(dow)] || []).forEach((w) => {
      const s = parseHM(w.start), e = parseHM(w.end);
      if (!s || !e) return;
      const winStart = Date.UTC(y, m - 1, d, s.hh, s.mm);
      const winEnd = Date.UTC(y, m - 1, d, e.hh, e.mm);
      for (let t = winStart; t + lenMs <= winEnd; t += stepMs) out.push({ startMs: t, endMs: t + lenMs });
    });
  });

  const timed = [];
  blocks.forEach((b) => {
    if (b.allDay) return;
    const s = parseHM(b.start), e = parseHM(b.end);
    if (!s || !e) return;
    blockDates(b).forEach((dISO) => {
      const [y, m, d] = dISO.split("-").map(Number);
      const bs = Date.UTC(y, m - 1, d, s.hh, s.mm);
      const be = Date.UTC(y, m - 1, d, e.hh, e.mm);
      if (be > bs) timed.push({ s: bs, e: be });
    });
  });
  return out
    .filter((o) => !timed.some((b) => o.startMs < b.e && b.s < o.endMs))
    .sort((x, z) => x.startMs - z.startMs);
}

let pass = 0, fail = 0;
function eq(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}

// Thu 2026-08-13 and Fri 2026-08-14, 9-to-5, hourly.
const HOURS = { weekly: { "4": [{ start: "09:00", end: "17:00" }], "5": [{ start: "09:00", end: "17:00" }] } };
const THU = "2026-08-13", FRI = "2026-08-14";
const DAYS = [THU, FRI];
const hhOn = (iso) => generateSlots({ ...HOURS }, [iso]).map((s) => new Date(s.startMs).toISOString().slice(11, 16));
const withBlocks = (blocks, iso) =>
  generateSlots({ ...HOURS, blocks }, [iso]).map((s) => new Date(s.startMs).toISOString().slice(11, 16));

console.log("blockDates");
eq("a one-day block is one date", blockDates({ date: THU }), [THU]);
eq("endDate equal to date is one date", blockDates({ date: THU, endDate: THU }), [THU]);
eq("a span is inclusive at both ends",
  blockDates({ date: THU, endDate: "2026-08-16" }), [THU, FRI, "2026-08-15", "2026-08-16"]);
// A holiday typed across the turn of the month is the case that catches a
// naive day-of-month loop.
eq("a span crosses a month boundary",
  blockDates({ date: "2026-08-30", endDate: "2026-09-02" }),
  ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]);

console.log("normalizeBlocks");
eq("a block with no times is all day",
  normalizeBlocks({ blocks: [{ date: THU }] }).blocks[0].allDay, true);
// Half a window would subtract nothing at all, which reads as "the coach is
// available" — the opposite of what they just said.
eq("a half-filled window closes the whole day",
  normalizeBlocks({ blocks: [{ date: THU, start: "14:00" }] }).blocks[0].allDay, true);
eq("an end before its start closes the whole day",
  normalizeBlocks({ blocks: [{ date: THU, start: "16:00", end: "14:00" }] }).blocks[0].allDay, true);
eq("a real window stays timed",
  normalizeBlocks({ blocks: [{ date: THU, start: "14:00", end: "16:00" }] }).blocks[0].allDay, false);
eq("an endDate before its date collapses to one day",
  normalizeBlocks({ blocks: [{ date: FRI, endDate: THU }] }).blocks[0].endDate, FRI);
eq("a junk date is dropped", normalizeBlocks({ blocks: [{ date: "soon" }] }).blocks.length, 0);

console.log("normalizeBlocks adopts legacy days off");
// The old "Days off" list has to become blocks, or the sheet shows an empty
// list beside a day athletes still can't book.
eq("a legacy blackout becomes an all-day block",
  normalizeBlocks({ blackouts: [THU] }).blocks,
  [{ id: `bo_${THU}`, date: THU, endDate: THU, allDay: true, start: "", end: "", label: "" }]);
// Idempotence is the whole reason the id is derived from the date: a cloud
// refresh hands back the blackouts array on every pull.
eq("adopting twice does not duplicate",
  normalizeBlocks(normalizeBlocks({ blackouts: [THU] })).blocks.length, 1);
eq("a date already covered by an all-day block is not adopted again",
  normalizeBlocks({ blackouts: [THU], blocks: [{ id: "b1", date: THU }] }).blocks.length, 1);
// A timed block does NOT cover the day, so a blackout on the same date is a
// separate fact and must survive.
eq("a blackout on a day with a timed block is still adopted",
  normalizeBlocks({ blackouts: [THU], blocks: [{ id: "b1", date: THU, start: "14:00", end: "16:00" }] }).blocks.length, 2);

console.log("the blackouts mirror");
eq("an all-day block writes its date",
  mirrorBlackouts(normalizeBlocks({ blocks: [{ date: THU }] }).blocks), [THU]);
eq("a span writes every date it covers",
  mirrorBlackouts(normalizeBlocks({ blocks: [{ date: THU, endDate: "2026-08-15" }] }).blocks),
  [THU, FRI, "2026-08-15"]);
// The gap this leaves is deliberate and documented: an hour closed off cannot
// be said in the old shape, and blacking out the whole day for stale clients
// would cost far more than the gap does.
eq("a timed block writes nothing",
  mirrorBlackouts(normalizeBlocks({ blocks: [{ date: THU, start: "14:00", end: "16:00" }] }).blocks), []);
// Removing a block only sticks if the mirror is rebuilt from what is LEFT.
eq("removing the last block empties the mirror",
  mirrorBlackouts(normalizeBlocks({ blackouts: [], blocks: [] }).blocks), []);

console.log("generateSlots, no blocks");
eq("a plain Thursday is 9 through 4", hhOn(THU),
  ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);

console.log("generateSlots, timed block");
eq("2-4pm takes exactly 2 and 3",
  withBlocks([{ id: "b", date: THU, start: "14:00", end: "16:00" }], THU),
  ["09:00", "10:00", "11:00", "12:00", "13:00", "16:00"]);
// Touching, not overlapping: a block that starts exactly when a slot ends must
// leave that slot alone, or every block silently eats the hour before it.
eq("a block starting at 2 leaves the 1pm slot",
  withBlocks([{ id: "b", date: THU, start: "14:00", end: "15:00" }], THU),
  ["09:00", "10:00", "11:00", "12:00", "13:00", "15:00", "16:00"]);
eq("a block ending at 2 leaves the 2pm slot",
  withBlocks([{ id: "b", date: THU, start: "13:00", end: "14:00" }], THU),
  ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00"]);
// Half an hour out of the middle still costs the whole slot: you cannot train
// somebody around a dentist appointment.
eq("a 30-minute block still takes the hour it lands in",
  withBlocks([{ id: "b", date: THU, start: "14:15", end: "14:45" }], THU),
  ["09:00", "10:00", "11:00", "12:00", "13:00", "15:00", "16:00"]);
eq("a block only affects its own date",
  withBlocks([{ id: "b", date: THU, start: "09:00", end: "17:00" }], FRI),
  ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);

console.log("generateSlots, all-day block");
eq("all day clears the day", withBlocks([{ id: "b", date: THU, allDay: true }], THU), []);
eq("a span clears every day in it",
  withBlocks([{ id: "b", date: THU, endDate: FRI, allDay: true }], FRI), []);
eq("the day after a span is untouched",
  generateSlots({ ...HOURS, blocks: [{ id: "b", date: "2026-08-06", endDate: "2026-08-07", allDay: true }] }, DAYS).length,
  16);

console.log("generateSlots, several blocks");
eq("two blocks on one day both apply",
  withBlocks([
    { id: "a", date: THU, start: "09:00", end: "11:00" },
    { id: "b", date: THU, start: "15:00", end: "17:00" },
  ], THU),
  ["11:00", "12:00", "13:00", "14:00"]);
eq("overlapping blocks don't double-remove anything",
  withBlocks([
    { id: "a", date: THU, start: "10:00", end: "13:00" },
    { id: "b", date: THU, start: "12:00", end: "15:00" },
  ], THU),
  ["09:00", "15:00", "16:00"]);

console.log(`\n${fail ? "FAILED" : "ok"} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
