// Closing time off: what a block subtracts from the bookable day — and the
// cancel-notice window beside it.
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
// Ported from tests/blocked-time.test.js and tests/cancel-window.test.js when
// the availability core moved out of the IIFE — tier 1 now, and STRONGER:
// those files ran TRIMMED COPIES (a reduced normalizeBlocks, a UTC-only
// generateSlots, an adapted cancelWindowClosed); this spec runs the shipped
// functions, so the real clamps, the real zone plumbing and the real
// bo_<date> adoption stand behind every assertion. cancelWindowClosed gained
// an injectable nowMs at the port (the repeatStarts precedent) so its
// boundaries pin exactly.
import { describe, it, afterAll } from "vitest";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./zone.js";
import "./series.js";
import "./availability.js";

const {
  normalizeAvailability, blockDates, availabilityIsSet,
  cancelWindowClosed, generateSlots, blackoutsMirrorOf,
} = globalThis.STSD.scheduling;

let n = 0;
const prevApp = globalThis.STSD.app;
globalThis.STSD.app = {
  ...prevApp,
  uid: () => "u" + (++n),
  dateISO: (d) => {
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
};
afterAll(() => { globalThis.STSD.app = prevApp; });

// Thu 2026-08-13 and Fri 2026-08-14, 9-to-5, hourly. UTC and leadHours 0 so
// the assertions say the same thing on any machine — the zone maths has its
// own coverage.
const HOURS = { tz: "UTC", leadHours: 0, weekly: { "4": [{ start: "09:00", end: "17:00" }], "5": [{ start: "09:00", end: "17:00" }] } };
const THU = "2026-08-13", FRI = "2026-08-14";
const dayMs = (iso) => Date.parse(iso + "T00:00:00Z");
const hh = (slots) => slots.map((s) => new Date(s.startMs).toISOString().slice(11, 16));
const hhOn = (iso) => hh(generateSlots({ ...HOURS }, dayMs(iso), 1, []));
const withBlocks = (blocks, iso) => hh(generateSlots({ ...HOURS, blocks }, dayMs(iso), 1, []));

describe("blockDates", () => {
  it("a one-day block is one date", () => assert.deepStrictEqual(blockDates({ date: THU }), [THU]));
  it("endDate equal to date is one date", () => assert.deepStrictEqual(blockDates({ date: THU, endDate: THU }), [THU]));
  it("a span is inclusive at both ends", () =>
    assert.deepStrictEqual(blockDates({ date: THU, endDate: "2026-08-16" }), [THU, FRI, "2026-08-15", "2026-08-16"]));
  // A holiday typed across the turn of the month is the case that catches a
  // naive day-of-month loop.
  it("a span crosses a month boundary", () =>
    assert.deepStrictEqual(blockDates({ date: "2026-08-30", endDate: "2026-09-02" }),
      ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02"]));
});

describe("normalizeAvailability's blocks", () => {
  const blocksOf = (av) => normalizeAvailability(av).blocks;
  it("a block with no times is all day", () =>
    assert.deepStrictEqual(blocksOf({ blocks: [{ date: THU }] })[0].allDay, true));
  // Half a window would subtract nothing at all, which reads as "the coach is
  // available" — the opposite of what they just said.
  it("a half-filled window closes the whole day", () =>
    assert.deepStrictEqual(blocksOf({ blocks: [{ date: THU, start: "14:00" }] })[0].allDay, true));
  it("an end before its start closes the whole day", () =>
    assert.deepStrictEqual(blocksOf({ blocks: [{ date: THU, start: "16:00", end: "14:00" }] })[0].allDay, true));
  it("a real window stays timed", () =>
    assert.deepStrictEqual(blocksOf({ blocks: [{ date: THU, start: "14:00", end: "16:00" }] })[0].allDay, false));
  it("an endDate before its date collapses to one day", () =>
    assert.deepStrictEqual(blocksOf({ blocks: [{ date: FRI, endDate: THU }] })[0].endDate, FRI));
  it("a junk date is dropped", () =>
    assert.deepStrictEqual(blocksOf({ blocks: [{ date: "soon" }] }).length, 0));
});

describe("normalizeAvailability adopts legacy days off", () => {
  // The old "Days off" list has to become blocks, or the sheet shows an empty
  // list beside a day athletes still can't book.
  it("a legacy blackout becomes an all-day block with the DERIVED id", () =>
    assert.deepStrictEqual(normalizeAvailability({ blackouts: [THU] }).blocks,
      [{ id: `bo_${THU}`, date: THU, endDate: THU, allDay: true, start: "", end: "", label: "" }]));
  // Idempotence is the whole reason the id is derived from the date (design
  // doc §4 rule 5): a cloud refresh hands back the blackouts array on every
  // pull.
  it("adopting twice does not duplicate", () =>
    assert.deepStrictEqual(normalizeAvailability(normalizeAvailability({ blackouts: [THU] })).blocks.length, 1));
  it("a date already covered by an all-day block is not adopted again", () =>
    assert.deepStrictEqual(normalizeAvailability({ blackouts: [THU], blocks: [{ id: "b1", date: THU }] }).blocks.length, 1));
  // A timed block does NOT cover the day, so a blackout on the same date is a
  // separate fact and must survive.
  it("a blackout on a day with a timed block is still adopted", () =>
    assert.deepStrictEqual(normalizeAvailability({ blackouts: [THU], blocks: [{ id: "b1", date: THU, start: "14:00", end: "16:00" }] }).blocks.length, 2));
});

describe("the blackouts mirror", () => {
  const mirror = (av) => blackoutsMirrorOf(normalizeAvailability(av).blocks);
  it("an all-day block writes its date", () =>
    assert.deepStrictEqual(mirror({ blocks: [{ date: THU }] }), [THU]));
  it("a span writes every date it covers", () =>
    assert.deepStrictEqual(mirror({ blocks: [{ date: THU, endDate: "2026-08-15" }] }), [THU, FRI, "2026-08-15"]));
  // The gap this leaves is deliberate and documented: an hour closed off cannot
  // be said in the old shape, and blacking out the whole day for stale clients
  // would cost far more than the gap does.
  it("a timed block writes nothing", () =>
    assert.deepStrictEqual(mirror({ blocks: [{ date: THU, start: "14:00", end: "16:00" }] }), []));
  // Removing a block only sticks if the mirror is rebuilt from what is LEFT.
  it("removing the last block empties the mirror", () =>
    assert.deepStrictEqual(mirror({ blackouts: [], blocks: [] }), []));
  it("the mirror is sorted whatever order the blocks were made in", () =>
    assert.deepStrictEqual(mirror({ blocks: [{ date: FRI }, { date: THU }] }), [THU, FRI]));
});

describe("generateSlots, no blocks", () => {
  it("a plain Thursday is 9 through 4", () =>
    assert.deepStrictEqual(hhOn(THU),
      ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]));
});

describe("generateSlots, timed block", () => {
  it("2-4pm takes exactly 2 and 3", () =>
    assert.deepStrictEqual(withBlocks([{ id: "b", date: THU, start: "14:00", end: "16:00" }], THU),
      ["09:00", "10:00", "11:00", "12:00", "13:00", "16:00"]));
  // Touching, not overlapping: a block that starts exactly when a slot ends
  // must leave that slot alone, or every block silently eats the hour before.
  it("a block starting at 2 leaves the 1pm slot", () =>
    assert.deepStrictEqual(withBlocks([{ id: "b", date: THU, start: "14:00", end: "15:00" }], THU),
      ["09:00", "10:00", "11:00", "12:00", "13:00", "15:00", "16:00"]));
  it("a block ending at 2 leaves the 2pm slot", () =>
    assert.deepStrictEqual(withBlocks([{ id: "b", date: THU, start: "13:00", end: "14:00" }], THU),
      ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00"]));
  // Half an hour out of the middle still costs the whole slot: you cannot
  // train somebody around a dentist appointment.
  it("a 30-minute block still takes the hour it lands in", () =>
    assert.deepStrictEqual(withBlocks([{ id: "b", date: THU, start: "14:15", end: "14:45" }], THU),
      ["09:00", "10:00", "11:00", "12:00", "13:00", "15:00", "16:00"]));
  it("a block only affects its own date", () =>
    assert.deepStrictEqual(withBlocks([{ id: "b", date: THU, start: "09:00", end: "17:00" }], FRI),
      ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]));
});

describe("generateSlots, all-day block", () => {
  it("all day clears the day", () =>
    assert.deepStrictEqual(withBlocks([{ id: "b", date: THU, allDay: true }], THU), []));
  it("a span clears every day in it", () =>
    assert.deepStrictEqual(withBlocks([{ id: "b", date: THU, endDate: FRI, allDay: true }], FRI), []));
  it("the day after a span is untouched", () =>
    assert.deepStrictEqual(
      generateSlots({ ...HOURS, blocks: [{ id: "b", date: "2026-08-06", endDate: "2026-08-07", allDay: true }] },
        dayMs(THU), 2, []).length,
      16));
});

describe("generateSlots, the other subtractions", () => {
  // NEW at the port: the copy-based file never exercised lead time or the
  // busy list — the two subtractions that share generateSlots with blocks.
  it("lead time removes the slots an athlete can no longer reach", () =>
    assert.deepStrictEqual(hh(generateSlots({ ...HOURS, leadHours: 12 }, dayMs(THU), 1, [])),
      ["12:00", "13:00", "14:00", "15:00", "16:00"]));
  it("an existing booking takes its slot out", () =>
    assert.deepStrictEqual(
      hh(generateSlots({ ...HOURS }, dayMs(THU), 1,
        [{ start: THU + "T10:00:00Z", end: THU + "T11:00:00Z" }])),
      ["09:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]));
});

describe("generateSlots, several blocks", () => {
  it("two blocks on one day both apply", () =>
    assert.deepStrictEqual(withBlocks([
      { id: "a", date: THU, start: "09:00", end: "11:00" },
      { id: "b", date: THU, start: "15:00", end: "17:00" },
    ], THU),
      ["11:00", "12:00", "13:00", "14:00"]));
  it("overlapping blocks don't double-remove anything", () =>
    assert.deepStrictEqual(withBlocks([
      { id: "a", date: THU, start: "10:00", end: "13:00" },
      { id: "b", date: THU, start: "12:00", end: "15:00" },
    ], THU),
      ["09:00", "15:00", "16:00"]));
});

// ---- Ported from tests/cancel-window.test.js — now against the REAL
// function, so the cancelHours clamp in normalizeAvailability stands behind
// every case rather than a re-typed copy of it.
describe("cancelWindowClosed", () => {
  const NOW = Date.parse("2026-08-08T18:00:00Z");
  const hoursOut = (h) => NOW + h * 3600000;
  const closed = (h, cancelHours) => cancelWindowClosed(hoursOut(h), { cancelHours }, NOW);

  it("24h notice: open outside, closed at and inside the line", () => {
    assert.deepStrictEqual(closed(48, 24), false);
    assert.deepStrictEqual(closed(25, 24), false);
    assert.deepStrictEqual(closed(24, 24), true, "exactly 24h out is closed");
    assert.deepStrictEqual(closed(23, 24), true);
    assert.deepStrictEqual(closed(1 / 6, 24), true, "10 minutes out is closed");
    assert.deepStrictEqual(closed(-1, 24), true, "already started is closed");
  });
  it("16h notice moves the line", () => {
    assert.deepStrictEqual(closed(17, 16), false);
    assert.deepStrictEqual(closed(16, 16), true);
    assert.deepStrictEqual(closed(15, 16), true);
  });
  it("no notice required leaves everything open", () => {
    // 0 is a real answer meaning "cancel whenever you like" — the usual falsy
    // fallback would silently overrule the coach who picked it.
    assert.deepStrictEqual(closed(1 / 6, 0), false);
    assert.deepStrictEqual(closed(-1, 0), false);
    assert.deepStrictEqual(closed(1 / 6, "0"), false, "0 as a string still opens it");
  });
  it("unset behaves as the 24h default", () => {
    assert.deepStrictEqual(closed(23, undefined), true);
    assert.deepStrictEqual(closed(25, undefined), false);
  });
});

describe("availabilityIsSet", () => {
  it("nothing written means nothing bookable", () => assert.deepStrictEqual(availabilityIsSet({}), false));
  it("a weekly window sets it", () =>
    assert.deepStrictEqual(availabilityIsSet({ weekly: { "1": [{ start: "09:00", end: "17:00" }] } }), true));
  it("a one-off extra sets it too", () =>
    assert.deepStrictEqual(availabilityIsSet({ extra: [{ date: THU, start: "08:00", end: "10:00" }] }), true));
});

// ---- WIRING: the writer must route through the lifted mirror, or the spec
// tests a derive the app no longer runs.
describe("wiring: saveCoachAvailability routes through blackoutsMirrorOf", () => {
  const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  it("the save rebuilds the mirror through the module", () =>
    assert.ok(appSrc.includes("a.blackouts = blackoutsMirrorOf(a.blocks);"),
      "saveCoachAvailability no longer calls the lifted mirror"));
  it("no inline rebuild survives beside it", () =>
    assert.ok(!appSrc.includes("a.blackouts = [...off].sort();"),
      "an inline copy of the mirror rebuild is still in app.js"));
});
