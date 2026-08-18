// buildProgramFromAthlete's allowlist, pinned from both sides. Ported when
// it moved out of the IIFE (tier 1 now: a real import of the shipped file).
// Assertions carried verbatim from tests/sync/program-allowlist.spec.js,
// except one ADDED test (marked below) pinning the top-level envelope.
//
// The function copies the coach's athlete record into the object the ATHLETE's
// device runs on, field by field, and its own comment says why that is a trap:
//
//   "This list is an allowlist, not a spread — a field omitted here is simply
//    absent on the athlete side, and the two maps disagree in silence."
//
// Silence is the operative word. A missing field is `undefined`, which is
// falsy, which reads as a legitimate "off" everywhere it lands. Nothing throws
// and nothing looks wrong.
//
// So this file asserts the allowlist against its two real obligations:
//   1. every field the athlete side READS off program.client is on it, and
//   2. nothing coach-private is.
// The allowlist is parsed from the shipped module file; the athlete-side
// reads are swept from app.js, where they still live — so a new athlete-side
// read of a field nobody added to the list fails here rather than shipping.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import "./program.js";

const { buildProgramFromAthlete } = globalThis.STSD.sync;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const appSrc = readFileSync(join(ROOT, "app.js"), "utf8");
const programSrc = readFileSync(join(HERE, "program.js"), "utf8");

/** The field names buildProgramFromAthlete actually emits under `client`. */
function allowlist() {
  const at = programSrc.indexOf("function buildProgramFromAthlete(");
  const block = programSrc.slice(at, programSrc.indexOf("\n  }", at));
  const clientBlock = block.slice(block.indexOf("client: {"));
  return new Set([...clientBlock.matchAll(/^\s{8}([A-Za-z_$][\w$]*):/gm)].map((m) => m[1]));
}

/** Every field read off the athlete-side program client, with line numbers. */
function athleteSideReads() {
  const re = /(?:state\.clientData\.program|clientData\.program|\bprog|\bprogram)\??\.client\??\.([A-Za-z_$][\w$]*)/g;
  const hits = new Map();
  for (const m of appSrc.matchAll(re)) {
    const line = appSrc.slice(0, m.index).split("\n").length;
    if (!hits.has(m[1])) hits.set(m[1], []);
    hits.get(m[1]).push(line);
  }
  return hits;
}

// Fields that live on a coach-side athlete record and must NEVER cross. Each
// one is either the coach's own working notes or a coach-only integration
// detail; `importedProgress` is excluded because progress travels as its own
// row, not inside the program.
const COACH_PRIVATE = ["notes", "setmoreAliases", "importedProgress", "_rev"];

describe("buildProgramFromAthlete: the allowlist", () => {
  it("carries every field the athlete side reads off program.client", () => {
    const allow = allowlist();
    const missing = [...athleteSideReads().entries()]
      .filter(([name]) => !allow.has(name))
      .map(([name, lines]) => `${name} (read at app.js:${lines.join(", ")})`);

    // A field read on the athlete side but never copied there is permanently
    // undefined. Two real examples this caught:
    //   hideOpenSlots — the athlete's "Open-slot alerts" toggle. Turning it off
    //     writes the DB column correctly, but the next program build drops it,
    //     so the preference silently comes back on at the next sign-in.
    //   partnerId — partnerWarningHtml() exists to tell one half of a couple
    //     that cancelling takes the session off their partner too. Undefined
    //     means that warning has never rendered for anyone.
    expect(missing, "read on the athlete side but not carried across").toEqual([]);
  });

  it("does not carry the coach's private fields", () => {
    const allow = allowlist();
    const leaked = COACH_PRIVATE.filter((f) => allow.has(f));
    expect(leaked, "coach-private fields must not reach the athlete").toEqual([]);
  });

  it("emits exactly the fields it is meant to, and no others", () => {
    // A deliberate pin. Adding a field here is a decision about what crosses to
    // someone else's device, so it should take an edit to this line as well.
    expect([...allowlist()].sort()).toEqual([
      "_coachId",
      "age",
      "coachPRs",
      "equipment",
      "goals",
      "heightIn",
      "hideOpenSlots",
      "id",
      "inviteCode",
      "name",
      "nutrition",
      "oneOffDays",
      "partnerId",
      "schedule",
      "sessionBank",
      "trainingLevel",
      "trainingPhase",
      "trials",
      "units",
      "weeks",
      "weightLb",
    ]);
  });
});

describe("buildProgramFromAthlete: behaviour", () => {
  const build = () => buildProgramFromAthlete;

  const athlete = () => ({
    id: "ath1",
    _rev: 7,
    name: "Test Athlete",
    age: "34",
    heightIn: "70",
    weightLb: "180",
    units: "kg",
    goals: "get strong",
    notes: "coach's private note — must not travel",
    trainingLevel: "intermediate",
    trainingPhase: "hypertrophy",
    equipment: ["barbell"],
    weeks: [{ id: "w1", days: [] }],
    oneOffDays: [{ id: "o1" }],
    trials: [{ id: "t1" }],
    schedule: { mon: "w1" },
    coachPRs: [{ id: "pr1" }],
    inviteCode: "ABCD-EFGH",
    sessionBank: { packages: [{ id: "p1" }], redemptions: [] },
    nutrition: { current: { kcal: 2400 }, history: [] },
    hideOpenSlots: true,
    partnerId: "ath2",
    setmoreAliases: ["Testy A"],
    importedProgress: { exerciseLogs: { a: [] } },
    _coachId: "coach1",
  });

  it("carries the athlete's own open-slot preference", () => {
    // The preference is the ATHLETE's, set on their own device, written to
    // their own row. A rebuild that drops it silently re-enables alerts they
    // turned off — and a rebuild happens on every sign-in, resync and realtime
    // row event.
    expect(build()(athlete()).client.hideOpenSlots).toBe(true);
    expect(build()({ ...athlete(), hideOpenSlots: false }).client.hideOpenSlots).toBe(false);
    // Absent on an older row means "not muted", never undefined.
    const bare = athlete();
    delete bare.hideOpenSlots;
    expect(build()(bare).client.hideOpenSlots).toBe(false);
  });

  it("carries partnerId so the shared-slot warning can render", () => {
    expect(build()(athlete()).client.partnerId).toBe("ath2");
    const solo = athlete();
    delete solo.partnerId;
    expect(build()(solo).client.partnerId).toBe(null);
  });

  it("leaves the coach's notes and integration details behind", () => {
    const client = build()(athlete()).client;
    expect(client.notes).toBeUndefined();
    expect(client.setmoreAliases).toBeUndefined();
    expect(client.importedProgress).toBeUndefined();
  });

  it("carries the row revision on the program, not the client", () => {
    // Intent (app.js comment): without _rev every boot left the realtime guard
    // at 0, so the first own-row echo after a reload always applied.
    const prog = build()(athlete());
    expect(prog._rev).toBe(7);
    expect(prog.client._rev).toBeUndefined();
    expect(build()({ ...athlete(), _rev: undefined })._rev).toBe(0);
  });

  it("normalises units to exactly lb or kg", () => {
    expect(build()(athlete()).client.units).toBe("kg");
    expect(build()({ ...athlete(), units: "lb" }).client.units).toBe("lb");
    // Anything else is not a unit; falling back to lb is the documented default.
    expect(build()({ ...athlete(), units: undefined }).client.units).toBe("lb");
    expect(build()({ ...athlete(), units: "stone" }).client.units).toBe("lb");
  });

  it("gives collection fields a usable empty shape rather than undefined", () => {
    const bare = build()({ id: "x", name: "X" }).client;
    expect(bare.weeks).toEqual([]);
    expect(bare.oneOffDays).toEqual([]);
    expect(bare.trials).toEqual([]);
    expect(bare.coachPRs).toEqual([]);
    expect(bare.equipment).toEqual([]);
    expect(bare.schedule).toEqual({});
    expect(bare.sessionBank).toEqual({ packages: [], redemptions: [] });
    expect(bare.nutrition).toEqual({ current: null, history: [] });
  });

  // ADDED at the port (2026-08-17): the original spec pinned only the client
  // block and _rev; the envelope fields had no assertion at all, so a mutant
  // that mistyped `kind` survived every test. kind is routed on for real —
  // the legacy access-code decode (app.js:27163) throws on anything that is
  // not "tp-program". v is the shape version; sharedAt currently has no
  // reader (stamped for provenance), pinned here because extraction
  // enshrines behaviour and the envelope is now frozen in a module.
  it("stamps the program envelope: kind, version, clientId, a sharedAt, and no trainer name", () => {
    const prog = build()(athlete());
    expect(prog.kind).toBe("tp-program");
    expect(prog.v).toBe(2);
    expect(prog.clientId).toBe("ath1");
    expect(prog.trainerName).toBe("");
    expect(prog.sharedAt).toBeGreaterThan(0);
  });
});
