// The one thing that can silently break coach notifications: the browser's
// category list and the Edge Function's default-mode table drifting apart.
//
// Deno cannot import src/notify/coach-kinds.js, so
// supabase/functions/_shared/coach-notify.ts carries its own DEFAULT_MODES
// copy. A category added here but not there is not a crash; it is a
// notification the server quietly refuses to send, because modeFor() returns
// "off" for a kind it has never heard of. That is exactly the failure nobody
// reports, so it gets a test that reads the real file as text.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import "./coach-kinds.js";

const { COACH_KINDS, GROUPS, MODES, DEFAULT_COACH_MODES, coachModeFor } = globalThis.STSD.notify;

const TS = fs.readFileSync(
  path.join(process.cwd(), "supabase", "functions", "_shared", "coach-notify.ts"),
  "utf8",
);

/** The DEFAULT_MODES object literal out of the shipped .ts, as real data. */
function serverDefaults() {
  const at = TS.indexOf("export const DEFAULT_MODES");
  expect(at, "DEFAULT_MODES must still be exported from coach-notify.ts").toBeGreaterThan(-1);
  const open = TS.indexOf("{", at);
  const close = TS.indexOf("};", open);
  const body = TS.slice(open + 1, close);
  const out = {};
  for (const line of body.split("\n")) {
    const m = /^\s*([a-z_]+)\s*:\s*"(off|instant|digest)"\s*,/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

describe("coach notification kinds", () => {
  it("the server knows every kind the app offers, with the same default", () => {
    const server = serverDefaults();
    expect(server, "parsed nothing out of coach-notify.ts").not.toEqual({});
    expect(server).toEqual(DEFAULT_COACH_MODES);
  });

  it("no kind is defined twice, and every one has a group that exists", () => {
    const ids = COACH_KINDS.map((k) => k.id);
    expect(new Set(ids).size, `duplicate kind id in ${ids.join(", ")}`).toBe(ids.length);
    const groups = new Set(GROUPS.map((g) => g.id));
    COACH_KINDS.forEach((k) => {
      expect(groups.has(k.group), `${k.id} is in unknown group ${k.group}`).toBe(true);
      expect(MODES.includes(k.def), `${k.id} defaults to ${k.def}`).toBe(true);
      expect(["row", "progress", "server"].includes(k.source), `${k.id} source ${k.source}`).toBe(true);
    });
  });

  it("every group has at least one kind in it, so the UI never draws an empty section", () => {
    GROUPS.forEach((g) => {
      expect(COACH_KINDS.some((k) => k.group === g.id), `group ${g.id} is empty`).toBe(true);
    });
  });

  it("coachModeFor falls back to the default, and refuses a kind it does not know", () => {
    expect(coachModeFor({}, "charge_failed")).toBe("instant");
    expect(coachModeFor({ charge_failed: "off" }, "charge_failed")).toBe("off");
    expect(coachModeFor({ charge_failed: "nonsense" }, "charge_failed")).toBe("instant");
    expect(coachModeFor(null, "workout_logged")).toBe("digest");
    expect(coachModeFor({ made_up: "instant" }, "made_up")).toBe("off");
  });

  it("the loud categories default to the digest, which is the whole point", () => {
    // If these ever flip to instant, a 28-athlete roster becomes twenty pushes
    // a day and the coach turns the feature off. Nathan's constraint, 2026-08-19.
    ["workout_logged", "pr_set", "day_skipped", "session_note"].forEach((k) => {
      expect(DEFAULT_COACH_MODES[k], `${k} must default to digest`).toBe("digest");
    });
    // …and the two that are only useful immediately do not.
    expect(DEFAULT_COACH_MODES.charge_failed).toBe("instant");
    expect(DEFAULT_COACH_MODES.readiness_low).toBe("instant");
  });
});
