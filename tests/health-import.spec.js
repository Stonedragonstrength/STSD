// Apple Health in-path: the shared merge layer and the export.xml scanner.
//
// Extracted real from app.js via load-fn — not re-coded here. What's pinned:
//
//   * normHealthWeight / normHealthWorkout turn webhook-or-scanner entries
//     into app-shaped ones, converting kg, mapping HK activity types onto
//     the app's CARDIO_TYPES names, and REFUSING strength workouts (they are
//     already logged in-app; importing them as cardio would double-count).
//   * mergeScaleEntries keeps its Renpho date+time dedupe but stamps the
//     caller's source; mergeCardioEntries dedupes on srcId when present,
//     else date+type+minutes — so re-imports and webhook replays add nothing.
//   * applyHealthPayloads is the one function both the inbox drain and the
//     file importer call.
//   * makeHealthXmlScanner survives records split across arbitrary chunk
//     boundaries and reads distance from the Workout attribute (old exports)
//     or the WorkoutStatistics child (new exports).
import { describe, it, expect } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

let uidN = 0;
const deps = () => ({ uid: () => `u${++uidN}`, KG_TO_LB: 2.20462 });

function load() {
  return loadFns(
    ["function normHealthWeight(", "function normHealthWorkout(",
     "function mergeScaleEntries(", "function mergeCardioEntries(",
     "function applyHealthPayloads(", "function makeHealthXmlScanner("],
    deps()
  );
}

describe("normHealthWeight / normHealthWorkout", () => {
  it("converts kg, keeps lb, refuses junk dates and values", () => {
    const { normHealthWeight } = load();
    expect(normHealthWeight({ date: "2026-08-19", weightKg: 82 }).weightLb).toBe("180.8");
    expect(normHealthWeight({ date: "2026-08-19", time: "07:11", weightLb: 179.96 })).toEqual(
      { date: "2026-08-19", time: "07:11", weightLb: "180" });
    expect(normHealthWeight({ date: "19/08/2026", weightLb: 180 })).toBe(null);
    expect(normHealthWeight({ date: "2026-08-19" })).toBe(null);
    expect(normHealthWeight({ date: "2026-08-19", weightLb: "heavy" })).toBe(null);
  });

  it("maps HK activity types, cleans unknown ones, skips strength", () => {
    const { normHealthWorkout } = load();
    expect(normHealthWorkout({ date: "2026-08-19", type: "HKWorkoutActivityTypeRunning", minutes: 30 }).type).toBe("Run");
    expect(normHealthWorkout({ date: "2026-08-19", type: "HKWorkoutActivityTypeHighIntensityIntervalTraining", minutes: 20 }).type).toBe("HIIT");
    expect(normHealthWorkout({ date: "2026-08-19", type: "HKWorkoutActivityTypePickleball", minutes: 45 }).type).toBe("Pickleball");
    expect(normHealthWorkout({ date: "2026-08-19", type: "HKWorkoutActivityTypeTraditionalStrengthTraining", minutes: 60 })).toBe(null);
    expect(normHealthWorkout({ date: "2026-08-19", type: "Run", minutes: 30 }).type).toBe("Run");
    expect(normHealthWorkout({ date: "2026-08-19", type: "Run" })).toBe(null); // minutes required
  });
});

describe("merge layer", () => {
  it("mergeScaleEntries stamps the caller's source and still dedupes", () => {
    const { mergeScaleEntries } = load();
    const log = [{ date: "2026-08-18", time: "07:00", weightLb: "181" }];
    const entries = [
      { date: "2026-08-18", time: "07:00", weightLb: "181" }, // dupe
      { date: "2026-08-19", time: "07:11", weightLb: "180" },
    ];
    expect(mergeScaleEntries(log, entries, "apple-health")).toBe(1);
    expect(log[1].source).toBe("apple-health");
  });

  it("mergeCardioEntries dedupes on srcId first, else date+type+minutes", () => {
    const { mergeCardioEntries } = load();
    const log = [];
    expect(mergeCardioEntries(log, [
      { date: "2026-08-19", type: "Run", minutes: 30, srcId: "abc" },
      { date: "2026-08-19", type: "Run", minutes: 30, srcId: "abc" }, // srcId dupe
      { date: "2026-08-19", type: "Run", minutes: 30 },               // key dupe of the first
      { date: "2026-08-19", type: "Bike", minutes: 45, miles: 10.5 },
    ])).toBe(2);
    expect(log.map((l) => l.type)).toEqual(["Run", "Bike"]);
    expect(log[1].miles).toBe(10.5);
    expect(log[0].source).toBe("apple-health");
  });

  it("applyHealthPayloads normalizes, merges both fields, reports counts", () => {
    const { applyHealthPayloads } = load();
    const progress = { bodyweightLog: [], cardioLogs: [] };
    const res = applyHealthPayloads(progress, [
      { weights: [{ date: "2026-08-19", weightKg: 82 }, { date: "bad" }],
        workouts: [{ date: "2026-08-19", type: "HKWorkoutActivityTypeWalking", minutes: 25 }] },
      { workouts: [{ date: "2026-08-19", type: "HKWorkoutActivityTypeWalking", minutes: 25 }] }, // replay
    ]);
    expect(res).toEqual({ weights: 1, workouts: 1 });
    expect(progress.bodyweightLog[0].weightLb).toBe("180.8");
    expect(progress.cardioLogs[0].type).toBe("Walk");
  });
});

describe("makeHealthXmlScanner", () => {
  const XML = `<?xml version="1.0"?><HealthData>
    <Record type="HKQuantityTypeIdentifierStepCount" value="9000" startDate="2026-08-18 08:00:00 -0400"/>
    <Record type="HKQuantityTypeIdentifierBodyMass" sourceName="Health" unit="kg" creationDate="x" startDate="2026-08-18 07:02:11 -0400" value="82"/>
    <Record type="HKQuantityTypeIdentifierBodyMass" unit="lb" startDate="2026-08-19 07:11:22 -0400" value="180.4"/>
    <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30.25" durationUnit="min" totalDistance="3.1" totalDistanceUnit="mi" startDate="2026-08-18 18:00:00 -0400">
    </Workout>
    <Workout workoutActivityType="HKWorkoutActivityTypeCycling" duration="45" durationUnit="min" startDate="2026-08-19 18:00:00 -0400">
      <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceCycling" sum="16.09344" unit="km"/>
    </Workout>
  </HealthData>`;

  const expectParsed = (s) => {
    const { weights, workouts } = s.result();
    expect(weights).toEqual([
      { date: "2026-08-18", time: "07:02", weightKg: 82 },
      { date: "2026-08-19", time: "07:11", weightLb: 180.4 },
    ]);
    expect(workouts.length).toBe(2);
    expect(workouts[0]).toEqual({ date: "2026-08-18", type: "HKWorkoutActivityTypeRunning", minutes: 30, miles: 3.1 });
    expect(workouts[1].type).toBe("HKWorkoutActivityTypeCycling");
    expect(workouts[1].minutes).toBe(45);
    expect(workouts[1].miles).toBeCloseTo(10, 1); // 16.09 km → mi
  };

  it("parses whole-file input", () => {
    const { makeHealthXmlScanner } = load();
    const s = makeHealthXmlScanner();
    s.feed(XML);
    expectParsed(s);
  });

  it("survives records split across arbitrary chunk boundaries", () => {
    const { makeHealthXmlScanner } = load();
    for (const size of [7, 33, 128]) {
      const s = makeHealthXmlScanner();
      for (let i = 0; i < XML.length; i += size) s.feed(XML.slice(i, i + size));
      expectParsed(s);
    }
  });
});
