// Reading an .xlsx without a library.
//
// The one that matters is the date. Excel does not store "8/12/26"; it stores
// 46246 and a style saying to draw it as a date. Get that wrong and the import
// does not crash, it silently drops every row, because scaleDateISO looks at
// "46246" and correctly says that is not a date. A wrong answer here looks
// exactly like an empty file.
//
// The reader was also run by hand against two genuine Excel workbooks on the
// coach's machine (236 rows and 32 rows, both with real date columns). Those
// are not checked in: one of them is personal financial data, and this repo is
// public.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import "../src/import/xlsx.js";

const require = createRequire(import.meta.url);
const { makeXlsxBuffer } = require("./helpers/make-xlsx.js");
const { xlsx } = globalThis.STSD;

const rowsOf = (csv) => csv.split("\r\n").map((l) => l.split(","));

describe("looksLikeZip", () => {
  it("knows a zip header from text", () => {
    expect(xlsx.looksLikeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(xlsx.looksLikeZip(new TextEncoder().encode("Date,Weight\n"))).toBe(false);
    expect(xlsx.looksLikeZip(new Uint8Array([]))).toBe(false);
    expect(xlsx.looksLikeZip(null)).toBe(false);
  });
});

describe("a Renpho export that went through Excel", () => {
  // Exactly what you get by opening the emailed CSV and pressing Save As.
  const buf = makeXlsxBuffer([
    ["No.", "Date", "Time", "Weight(lb)", "BMI", "Body Fat Percentage(%)"],
    [1, { date: "2026-08-12" }, { time: "08:18:17" }, 180, 25.1, 22],
    [2, { date: "2026-08-13" }, { time: "07:02:00" }, 182.4, 25.4, "--"],
  ]);

  it("turns the date serial back into a date", async () => {
    const { csv, error } = await xlsx.toCsv(buf);
    expect(error).toBe(null);
    expect(rowsOf(csv)[1][1]).toBe("2026-08-12");
    expect(rowsOf(csv)[2][1]).toBe("2026-08-13");
  });

  it("turns the time serial back into a clock, not a fraction", async () => {
    const { csv } = await xlsx.toCsv(buf);
    expect(rowsOf(csv)[1][2]).toBe("08:18:17");
  });

  it("keeps the numbers and the shared strings", async () => {
    const { csv } = await xlsx.toCsv(buf);
    expect(rowsOf(csv)[0]).toEqual(["No.", "Date", "Time", "Weight(lb)", "BMI", "Body Fat Percentage(%)"]);
    expect(rowsOf(csv)[1][3]).toBe("180");
    expect(rowsOf(csv)[2][5]).toBe("--");
  });

  it("comes out as something the app's own CSV parser can read", async () => {
    const { csv } = await xlsx.toCsv(buf);
    // The whole design: the xlsx path produces TEXT and changes nothing
    // downstream. This is the contract parseScaleCsv relies on.
    expect(csv.split("\r\n").length).toBe(3);
    expect(csv.startsWith("No.,Date,Time,")).toBe(true);
  });
});

describe("the awkward cells", () => {
  it("does not put a midnight clock on a plain date", async () => {
    const { csv } = await xlsx.toCsv(makeXlsxBuffer([["d"], [{ date: "2026-01-05" }]]));
    expect(rowsOf(csv)[1][0]).toBe("2026-01-05");
  });

  it("keeps the clock when the cell has one", async () => {
    const { csv } = await xlsx.toCsv(makeXlsxBuffer([["d"], [{ date: "2026-01-05", time: "13:45:30" }]]));
    expect(rowsOf(csv)[1][0]).toBe("2026-01-05 13:45:30");
  });

  it("holds a row's shape when the middle cell is missing", async () => {
    // Excel omits an empty cell entirely. Filling from the cell's own
    // reference is what stops everything after the gap shifting left.
    const { csv } = await xlsx.toCsv(makeXlsxBuffer([["a", "b", "c"], ["1", null, "3"]]));
    expect(rowsOf(csv)[1]).toEqual(["1", "", "3"]);
  });

  it("reads an inline string, which is what some exporters write", async () => {
    const { csv } = await xlsx.toCsv(makeXlsxBuffer([[{ inline: "Weight(lb)" }], [180]]));
    expect(rowsOf(csv)[0][0]).toBe("Weight(lb)");
  });

  it("quotes a value containing a comma instead of splitting the row", async () => {
    const { csv } = await xlsx.toCsv(makeXlsxBuffer([["note"], ["one, two"]]));
    expect(csv.split("\r\n")[1]).toBe('"one, two"');
  });

  it("brings XML entities back to the characters they stand for", async () => {
    const { csv } = await xlsx.toCsv(makeXlsxBuffer([["note"], ["Bench & Row <heavy>"]]));
    expect(csv.split("\r\n")[1]).toBe("Bench & Row <heavy>");
  });

  it("counts a Mac workbook's dates from 1904", async () => {
    const mac = makeXlsxBuffer([["d"], [{ date: "2026-08-12" }]], { date1904: true });
    // toSerial writes the 1900-based number; a 1904 workbook reading the same
    // serial lands four years and a day later, which is the bug this guards.
    const { csv } = await xlsx.toCsv(mac);
    expect(rowsOf(csv)[1][0]).toBe("2030-08-13");
  });

  it("drops the blank rows Excel leaves behind a delete", async () => {
    const { csv } = await xlsx.toCsv(makeXlsxBuffer([["a"], ["1"], [""], [""]]));
    expect(csv.split("\r\n").length).toBe(2);
  });

  it("finds the sheet even when it is not called sheet1", async () => {
    const { csv, error } = await xlsx.toCsv(
      makeXlsxBuffer([["a"], ["1"]], { sheetFile: "sheet42.xml" }));
    expect(error).toBe(null);
    expect(csv).toBe("a\r\n1");
  });
});

describe("files it cannot read say why", () => {
  it("refuses a zip that is not a workbook", async () => {
    const { zip } = require("./helpers/make-xlsx.js");
    const b = zip([{ name: "hello.txt", data: "not a spreadsheet" }]);
    const { error } = await xlsx.toCsv(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
    expect(error).toMatch(/cannot read|not a readable/i);
  });

  it("refuses bytes that are not a zip at all", async () => {
    const { error } = await xlsx.toCsv(new TextEncoder().encode("Date,Weight\n1,2\n").buffer);
    expect(error).toMatch(/not a readable spreadsheet/i);
  });

  it("refuses an empty sheet rather than importing nothing quietly", async () => {
    const { error } = await xlsx.toCsv(makeXlsxBuffer([]));
    expect(error).toMatch(/empty/i);
  });
});
