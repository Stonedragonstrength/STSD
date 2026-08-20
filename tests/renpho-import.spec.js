// A real Renpho export's SHAPE, parsed by the real parser out of app.js.
//
// The numbers are invented and the athlete is nobody. What is real, and what
// this fixture exists for, is the format: every fix this importer has needed
// came from an export behaving unlike the one before it. Renpho writes
// "2026.06.26", the same file after a trip through Excel comes back as
// "8/12/26", and which one you get depends on the PHONE's locale, so every
// athlete's file can differ.
//
// It also carries a row where every reading except weight and BMI is "--",
// which is what a weigh-in looks like when the scale could not read impedance,
// and a header with a non-unit parenthesis in it.
//
// Athlete data does not go in this repo: it is public and permanent.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFns } from "./helpers/load-fn.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const csv = readFileSync(join(HERE, "fixtures", "renpho-export.csv"), "utf8");

const { parseScaleCsv } = loadFns(
  ["function csvSplitLine(", "function scaleDateISO(", "function normScaleTime(",
   "function parseScaleCsv("],
  { KG_TO_LB: 2.20462 },
);

describe("a real-shaped Renpho export", () => {
  const { entries, error } = parseScaleCsv(csv);

  it("parses without an error", () => {
    expect(error).toBe(null);
  });

  it("keeps the weigh-in that has readings and the one that has only a weight", () => {
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.weightLb)).toEqual(["180", "182.4"]);
  });

  it("reads the two-digit Excel date as 2026, not 0026 or 2012", () => {
    expect(entries.every((e) => e.date === "2026-08-12")).toBe(true);
  });

  it("turns the 12-hour time into a sortable one", () => {
    expect(entries[0].time).toBe("08:18:17");
  });

  it("carries the body composition through, without the -- placeholders", () => {
    const byLabel = Object.fromEntries(entries[0].metrics.map((m) => [m.label, m]));
    expect(byLabel["Body Fat Percentage"]).toEqual({ label: "Body Fat Percentage", value: 22, unit: "%" });
    expect(byLabel["Muscle Mass"]).toEqual({ label: "Muscle Mass", value: 129.6, unit: "lb" });
    // The row where the impedance reading failed keeps exactly what the scale
    // could still work out from weight alone, and invents nothing.
    expect(entries[1].metrics).toEqual([{ label: "BMI", value: 25.4, unit: "" }]);
  });

  it("does not keep the row number as a metric", () => {
    expect(entries[0].metrics.some((m) => /^no\.?$/i.test(m.label))).toBe(false);
  });
});

describe("files that are not CSVs at all", () => {
  // What a real .xlsx looks like to FileReader.readAsText: a zip header.
  it("names a spreadsheet as the problem, instead of blaming the columns", () => {
    const { error } = parseScaleCsv("PK\u0003\u0004\u0014\u0000\u0006\u0000binary noise");
    expect(error).toMatch(/spreadsheet/i);
    expect(error).toMatch(/Save As/i);
  });

  it("does not call a photo a spreadsheet", () => {
    const { error } = parseScaleCsv("\u00ff\u00d8\u00ff\u0000\u0010JFIF junk");
    expect(error).toMatch(/not a CSV/i);
    expect(error).not.toMatch(/spreadsheet, not/i);
  });

  it("still parses a normal CSV that happens to mention PK", () => {
    const { entries, error } = parseScaleCsv("Date,Weight(lb),Note\n8/12/26,218.0,PK test\n");
    expect(error).toBe(null);
    expect(entries.length).toBe(1);
  });
});
