// The two coach notifications that are derived rather than evented.
//
// Both fail by being plausible. "Gone quiet" fires on a roster of real people
// whose last session was some ordinary number of days ago, and getting the
// rule slightly wrong does not throw: it either says nothing forever, or says
// the same three names every single day until the coach turns the category
// off. "Still uncollected" reads the same package objects the money screens
// read, and a wrong answer there looks exactly like a right one.
//
// So the rules are pure functions with fixtures, tested away from the cron.
import { describe, it, expect } from "vitest";
import {
  QUIET_DAYS, UNCOLLECTED_FROM_DAY, daysBetween, lastLoggedOn, quietCrossers,
  uncollectedIsDue, uncollectedThisMonth, nameList,
} from "../supabase/functions/_shared/coach-derived.ts";

const TODAY = "2026-08-20";
/** N days before TODAY, as the app writes it. */
const ago = (n) => new Date(Date.parse(TODAY + "T00:00:00Z") - n * 86400000).toISOString().slice(0, 10);

describe("daysBetween", () => {
  it("counts whole days", () => expect(daysBetween("2026-08-13", TODAY)).toBe(7));
  it("crosses a month end", () => expect(daysBetween("2026-07-31", "2026-08-01")).toBe(1));
  it("is 0 for the same day", () => expect(daysBetween(TODAY, TODAY)).toBe(0));
  it("refuses junk rather than guessing", () => expect(daysBetween("", TODAY)).toBe(null));
});

describe("lastLoggedOn", () => {
  it("takes the latest date across every day", () => {
    expect(lastLoggedOn({ d1: ["2026-08-01"], d2: ["2026-08-14"], d3: ["2026-08-09"] }))
      .toBe("2026-08-14");
  });
  it("ignores a day that was un-ticked", () => {
    expect(lastLoggedOn({ d1: ["2026-08-01"], d2: [] })).toBe("2026-08-01");
  });
  it("is null when nothing was ever logged", () => {
    expect(lastLoggedOn({})).toBe(null);
    expect(lastLoggedOn(null)).toBe(null);
    expect(lastLoggedOn({ d1: [], d2: [] })).toBe(null);
  });
});

describe("quietCrossers", () => {
  // A believable roster: most people trained this week, one is drifting, one
  // has been gone a month, one signed up and never started.
  const roster = [
    { id: "a1", name: "Kristyn", dayCompletions: { d1: [ago(1)], d2: [ago(4)] } },
    { id: "a2", name: "Dan", dayCompletions: { d1: [ago(7)], d2: [ago(21)] } },
    { id: "a3", name: "Cheryl", dayCompletions: { d1: [ago(6)] } },
    { id: "a4", name: "Marcus", dayCompletions: { d1: [ago(8)] } },
    { id: "a5", name: "Priya", dayCompletions: { d1: [ago(50)] } },
    { id: "a6", name: "New Guy", dayCompletions: {} },
  ];

  it("fires only for the athlete crossing the line today", () => {
    expect(quietCrossers(roster, TODAY).map((a) => a.name)).toEqual(["Dan"]);
  });

  it("says nothing about someone who crossed it yesterday", () => {
    // The whole point: Marcus at 8 days and Priya at 50 were already reported
    // on the day they crossed. Repeating them daily is what makes a coach
    // switch the category off.
    const names = quietCrossers(roster, TODAY).map((a) => a.name);
    expect(names).not.toContain("Marcus");
    expect(names).not.toContain("Priya");
  });

  it("says nothing about someone who has never logged a session", () => {
    expect(quietCrossers(roster, TODAY).map((a) => a.id)).not.toContain("a6");
  });

  it("reads the most recent day, not the first", () => {
    // Dan's OTHER day is 21 days old. Taking the oldest would report everyone
    // who has ever had a gap.
    expect(quietCrossers([roster[0]], TODAY)).toEqual([]);
  });

  it("moves with the threshold", () => {
    expect(quietCrossers(roster, TODAY, 6).map((a) => a.name)).toEqual(["Cheryl"]);
    expect(QUIET_DAYS).toBe(7);
  });
});

describe("uncollectedIsDue", () => {
  it("stays quiet in the first days of a month, when everything is unpaid", () => {
    expect(uncollectedIsDue("2026-08-01")).toBe(false);
    expect(uncollectedIsDue("2026-08-04")).toBe(false);
  });
  it("speaks from the fifth", () => {
    expect(uncollectedIsDue("2026-08-05")).toBe(true);
    expect(uncollectedIsDue("2026-08-28")).toBe(true);
    expect(UNCOLLECTED_FROM_DAY).toBe(5);
  });
});

describe("uncollectedThisMonth", () => {
  const bank = (packages) => ({ packages, redemptions: [] });
  const roster = [
    // Paid up for August.
    { id: "a1", name: "Kristyn", bank: bank([{ id: "p1", size: 8, membershipGrant: "2026-08" }]) },
    // August granted, not paid.
    { id: "a2", name: "Dan", bank: bank([{ id: "p2", size: 4, membershipGrant: "2026-08", unpaid: true }]) },
    // The retired third state still reads as owed.
    { id: "a3", name: "Cheryl", bank: bank([{ id: "p3", size: 12, autoRenewGrant: "2026-08", status: "pending" }]) },
    // July's unpaid grant is last month's problem, not this month's.
    { id: "a4", name: "Marcus", bank: bank([{ id: "p4", size: 4, membershipGrant: "2026-07", unpaid: true }]) },
    // A pack bought outright carries no month and is not part of a collection.
    { id: "a5", name: "Priya", bank: bank([{ id: "p5", size: 10, unpaid: true }]) },
    { id: "a6", name: "No Bank", bank: null },
  ];

  it("finds only this month's unpaid grants", () => {
    expect(uncollectedThisMonth(roster, "2026-08").map((r) => r.name)).toEqual(["Dan", "Cheryl"]);
  });

  it("carries the sessions the money was for", () => {
    const byName = Object.fromEntries(uncollectedThisMonth(roster, "2026-08").map((r) => [r.name, r.sessions]));
    expect(byName).toEqual({ Dan: 4, Cheryl: 12 });
  });

  it("sums more than one grant in the same month", () => {
    const two = [{ id: "x", name: "Split", bank: bank([
      { id: "p1", size: 4, membershipGrant: "2026-08", unpaid: true },
      { id: "p2", size: 2, membershipGrant: "2026-08", unpaid: true },
    ]) }];
    expect(uncollectedThisMonth(two, "2026-08")[0].sessions).toBe(6);
  });

  it("is empty when everyone has paid", () => {
    expect(uncollectedThisMonth([roster[0], roster[5]], "2026-08")).toEqual([]);
  });
});

describe("nameList", () => {
  it("one name", () => expect(nameList(["Dan"])).toBe("Dan"));
  it("two names", () => expect(nameList(["Dan", "Cheryl"])).toBe("Dan and Cheryl"));
  it("three names", () => expect(nameList(["Dan", "Cheryl", "Kristyn"])).toBe("Dan, Cheryl and Kristyn"));
  it("four names", () => expect(nameList(["Dan", "Cheryl", "Kristyn", "Marcus"])).toBe("Dan, Cheryl, Kristyn and 1 more"));
});
