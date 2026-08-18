// The Setmore double-charge guard keyed sessions on a minute bucket and
// compared with ===, so 08:59:59 and 09:00:01 — one session, two seconds
// apart — never matched. slotsMatch is the tolerance every slot comparison
// now goes through: same or adjacent bucket is the same session, two buckets
// apart is not (real sessions sit at least fifteen minutes apart).
import { describe, it, expect } from "vitest";
import { loadFn } from "./helpers/load-fn.js";

const slotsMatch = loadFn("function slotsMatch(");

const bucket = (iso) => Math.floor(new Date(iso).getTime() / 60000);

describe("slotsMatch", () => {
  it("same bucket matches", () => {
    expect(slotsMatch(100, 100)).toBe(true);
  });

  it("a second's drift across a minute boundary still matches", () => {
    expect(slotsMatch(bucket("2026-08-17T08:59:59Z"), bucket("2026-08-17T09:00:01Z"))).toBe(true);
  });

  it("two buckets apart is a different session", () => {
    expect(slotsMatch(100, 102)).toBe(false);
    expect(slotsMatch(bucket("2026-08-17T09:00:00Z"), bucket("2026-08-17T09:15:00Z"))).toBe(false);
  });

  it("a missing slot never matches anything", () => {
    expect(slotsMatch(null, 100)).toBe(false);
    expect(slotsMatch(100, undefined)).toBe(false);
    expect(slotsMatch(null, null)).toBe(false);
  });
});
