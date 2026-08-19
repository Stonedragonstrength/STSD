// The calendar income summary — grouping and totals for the visible frame.
import { describe, it, expect } from "vitest";
import "./cal-income.js";

const { calIncomeSummary } = globalThis.STSD.money;

const ev = (who) => ({ who });
const resolve = (e) =>
  e.who === "gold" ? { label: "Gold", rate: 90 } :
  e.who === "gold2" ? { label: "Gold", rate: 85 } :
  e.who === "casual" ? { label: "No membership", rate: 70 } :
  e.who === "unpriced" ? { label: "No membership", rate: 0 } :
  null;

describe("calIncomeSummary", () => {
  it("groups by label, sums sessions and amounts, sorts by amount desc with label ties", () => {
    const s = calIncomeSummary(
      ["2026-08-10", "2026-08-11"],
      { "2026-08-10": [ev("gold"), ev("casual")], "2026-08-11": [ev("gold2")] },
      resolve);
    expect(s.groups).toEqual([
      { label: "Gold", sessions: 2, amount: 175 },
      { label: "No membership", sessions: 1, amount: 70 },
    ]);
    expect(s.amount).toBe(245);
    expect(s.sessions).toBe(3);
  });

  it("unlinked sessions count toward the frame's session total but carry no amount and no group", () => {
    const s = calIncomeSummary(["2026-08-10"],
      { "2026-08-10": [ev("gold"), ev("ghost")] }, resolve);
    expect(s.sessions).toBe(2);
    expect(s.unlinked).toBe(1);
    expect(s.amount).toBe(90);
    expect(s.groups.length).toBe(1);
  });

  it("a resolved athlete with no rate still groups, at zero, and is counted unpriced", () => {
    const s = calIncomeSummary(["2026-08-10"],
      { "2026-08-10": [ev("unpriced"), ev("casual")] }, resolve);
    expect(s.unpriced).toBe(1);
    expect(s.groups).toEqual([{ label: "No membership", sessions: 2, amount: 70 }]);
  });

  it("days with nothing on them and an empty frame produce zeros, not throws", () => {
    expect(calIncomeSummary(["2026-08-10"], {}, resolve))
      .toEqual({ groups: [], sessions: 0, amount: 0, unlinked: 0, unpriced: 0 });
    expect(calIncomeSummary([], null, resolve).sessions).toBe(0);
  });

  it("only the frame's dates are summed — the map may hold a whole month", () => {
    const map = { "2026-08-10": [ev("gold")], "2026-08-11": [ev("casual")] };
    const s = calIncomeSummary(["2026-08-10"], map, resolve);
    expect(s.sessions).toBe(1);
    expect(s.amount).toBe(90);
  });
});
