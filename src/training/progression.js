// Extracted from app.js — Phase 2 (Training) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/training/progression.spec.js
// imports THIS file and reads the namespace, so the shipped code is the
// tested code.
//
// The double-progression engine: the one place that computes every
// athlete's targets. Its key invariant is unchanged by the move — PROGRAM
// DATA IS NEVER MUTATED; the effective target is computed by walking each
// lift's copies across weeks and logs, so a BW-graduating lift stays
// written "BW" every week while the computed target climbs.
(function () {
  "use strict";

  // From src/training/tags.js, library.js and readiness.js, which index.html
  // loads first (the boot smoke executes the tags in that order). Checked at
  // load so a missing or misordered tag fails HERE, by name.
  const {
    exIsTimed, bandOf, liftKey,
    readinessScore, readinessFlagAnswer, READINESS_QS, READY_LOW_MAX,
  } = globalThis.STSD.training;
  if (typeof exIsTimed !== "function" || typeof bandOf !== "function" ||
      typeof liftKey !== "function" || typeof readinessScore !== "function") {
    throw new Error("src/training/{tags,library,readiness}.js must load before progression.js");
  }

  // Three optional layers ride on top of that base ladder, each off by default
  // so every rule written before them behaves exactly as it always did:
  //   • the SET leg (rule.addSets) — reps top out, ADD A SET, reps reset, and
  //     only once the extra sets are spent does the weight move;
  //   • STALL handling (rule.backoff / rule.stallAfter) — consecutive failed
  //     weeks are counted, and the coach can have the chain back off a % and
  //     re-climb instead of sitting at a wall forever;
  //   • RIR autoregulation — the athlete tags a locked exercise with how much
  //     was left in the tank, and the engine reads it against what the set was
  //     ASKED to feel like (rule.targetRir). Two easy sessions IN A ROW earn
  //     one extra rep rung; a session ground out two under target HOLDS the
  //     ladder even though the reps were there; and a miss with plenty left
  //     never counts as a stall (they stopped early, they didn't fail).
  //     The weight leg moves one increment whatever the effort said.
  // Ceiling sentinel for bodyweight rep ladders with no cap ("∞").
  const PROG_NO_CAP = 999;
  // Timed exercises run the SAME double progression, but the ladder rung is
  // seconds, not reps — so the auto-target climbs by this many seconds per
  // successful week instead of +1. (Reps always climb by 1.)
  const PROG_TIME_STEP = 5;
  // Set leg: how many extra sets a rule may stack before the weight moves.
  const PROG_MAX_ADD_SETS = 2;
  // Stall handling: failed weeks in a row before a back-off fires, and the
  // back-off sizes the coach can pick from.
  const PROG_STALL_DEFAULT = 2;
  const PROG_BACKOFF_PCTS = [10, 15];
  // Stall count at which the athlete's card starts saying so out loud. One
  // held week is normal; two in a row is a signal.
  const PROG_STALL_SHOW = 2;
  // RIR ("reps in reserve") buckets the athlete can tag a locked exercise with.
  // PROG_RIR_EASY is the value behind the top button, not a rule any more —
  // effort is judged against the exercise's TARGET, so the same tap means
  // different things in a strength block and a hypertrophy one.
  const PROG_RIR_EASY = 4;
  // What the set was supposed to feel like. Two left in the tank is the
  // default ask, which is exactly what the three buttons already say: None is
  // two under it, About 2 is on it, 4 or more is two over.
  const PROG_RIR_TARGET = 2;
  // How far off target counts as a different KIND of session rather than
  // noise. One rep either way is a judgement call; two is a fact.
  const PROG_RIR_BAND = 2;
  // Sessions this dated or later are judged by the rules above. Everything
  // logged before it keeps the old single-session doubling.
  //
  // The engine holds no state — it re-walks the whole log on every render —
  // so a rule change re-grades history, and an athlete who had been tagging
  // "4 or more" would have opened the app to a bar 10 or 15lb lighter than
  // yesterday with nothing on screen explaining it. Nathan's call (2026-08-19)
  // was to grandfather rather than re-grade. The fork costs one date compare
  // and should be deleted once no live chain reaches back past it.
  const PROG_RIR_V2_FROM = "2026-08-20";

  function progressionRule(ex) {
    const p = ex && ex.progression;
    if (!p || !p.ceil) return null;
    const floor = parseInt(ex.currentReps, 10);
    if (!floor) return null; // needs a rep (or time) floor
    const ceil = parseInt(p.ceil, 10);
    if (!ceil || ceil <= floor) return null;
    // Timed exercises climb the ladder in seconds — same chain, bigger rung.
    const timed = exIsTimed(ex);
    const step = timed ? PROG_TIME_STEP : 1;
    // The three optional layers. Every one of them is clamped here so the rest
    // of the engine can trust the numbers without re-checking.
    const bo = parseInt(p.backoff, 10);
    const tr = parseInt(p.targetRir, 10);
    const layers = {
      addSets: Math.max(0, Math.min(PROG_MAX_ADD_SETS, parseInt(p.sets, 10) || 0)),
      backoff: PROG_BACKOFF_PCTS.includes(bo) ? bo : 0,
      stallAfter: Math.max(1, parseInt(p.stallAfter, 10) || PROG_STALL_DEFAULT),
      // What the set is meant to feel like. Clamped rather than trusted: a
      // target above the top button would make "easy" unreachable and quietly
      // freeze the ladder.
      targetRir: Number.isFinite(tr) ? Math.max(0, Math.min(PROG_RIR_EASY, tr)) : PROG_RIR_TARGET,
    };
    // Bodyweight: rep ladder. Without an increment it holds at the cap forever.
    // With an increment (and a real cap) it *graduates*: at the cap it starts
    // adding weight and reps reset, then climbs as a normal double-progression.
    if (ex.currentWeight === "BW") {
      const bwInc = parseFloat(p.inc);
      if (bwInc && ceil !== PROG_NO_CAP) {
        const bwReset = parseInt(p.reset, 10);
        return { floor, ceil, inc: bwInc, reset: bwReset >= 1 && bwReset < ceil ? bwReset : floor, bw: true, graduate: true, step, timed, ...layers };
      }
      return { floor, ceil, inc: 0, reset: floor, bw: true, step, timed, ...layers };
    }
    // A band-only lift has no number to climb — the band is the load. It gets
    // the same rep ladder bodyweight gets without an increment: reps climb to
    // the ceiling and hold there, and the card offers the next band at the top.
    // Without this it bails on the parseFloat below and has no progression at
    // all, which is what it has had since bands existed.
    if (!String(ex.currentWeight || "").trim() && bandOf(ex)) {
      return { floor, ceil, inc: 0, reset: floor, band: true, repsOnly: true, step, timed, ...layers };
    }
    const base = parseFloat(ex.currentWeight);
    if (!isFinite(base)) return null;
    // Reps-only (weighted): the weight stays as written — reps climb to the
    // ceiling and hold there. Same ladder as bodyweight, but with a bar.
    if (p.repsOnly) {
      const roReset = parseInt(p.reset, 10);
      return { floor, ceil, inc: 0, reset: roReset >= 1 && roReset < ceil ? roReset : floor, repsOnly: true, step, timed, ...layers };
    }
    const inc = parseFloat(p.inc);
    if (!inc) return null; // weighted needs a base + increment
    // Optional custom rep target after a weight jump ("sometimes the reps
    // need to drop when going up in weight") — defaults to the floor.
    const reset = parseInt(p.reset, 10);
    return { floor, ceil, inc, reset: reset >= 1 && reset < ceil ? reset : floor, step, timed, ...layers };
  }

  // The athlete's most recent locked log for this exercise copy, read against
  // that week's effective weight and effective set count. Returns:
  //   { logged: false }           — nothing to judge: no locked log, a whole-
  //                                 exercise skip, or fewer sets logged than
  //                                 prescribed. The chain holds, and it does
  //                                 NOT count as a stall. They didn't fail,
  //                                 they didn't train.
  //   { logged: true, min: null } — a real attempt that fell short: a skipped
  //                                 set, or a set under the target weight.
  //   { logged: true, min: n }    — every set made weight; n is the WORST
  //                                 set's reps (or seconds, when timed).
  // `rir` rides along when the athlete tagged how much was left in the tank.
  // `protect` rides along when the athlete checked in beat up before this
  // session — see the readiness section. It only ever cancels a stall.
  function progressionAttempt(exCopy, effWeight, effSets, logsMap, ctx) {
    // `date` rides along so the step can tell which ruleset judges this
    // session — see PROG_RIR_V2_FROM.
    const none = { logged: false, min: null, rir: null, protect: false, date: null };
    const arr = logsMap?.[exCopy.id];
    if (!Array.isArray(arr) || !arr.length) return none;
    const entry = [...arr].sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .find((l) => l.locked === true && (l.skipped || (Array.isArray(l.sets) && l.sets.length)));
    if (!entry || entry.skipped) return none; // whole-exercise skip: targets hold, no stall
    // A sanctioned one-session pullback (two same-day skips in a row, athlete
    // accepted 15% off — see the skip-day design doc). Judged like a skip:
    // chain frozen. Judged as an attempt it would read "under target weight =
    // miss" and stall the ladder for taking the offer the app itself made.
    if (entry.deload) return none;
    const need = effSets || 0;
    if (!need || entry.sets.length < need) return none;
    const parsedRir = parseInt(entry.rir, 10);
    const rir = Number.isFinite(parsedRir) ? parsedRir : null;
    // Only a check-in dated to the session being judged counts. A readiness
    // answer from a later pass through this day must not reach back and excuse
    // an older log. A "very hungover" answer protects on its own — it sits
    // outside the score (see READINESS_FLAG) but it is the same honest brake.
    const rdy = ctx?.readyMap?.[ctx.dayId];
    const protect = !!rdy && String(rdy.date) === String(entry.date) &&
      ((readinessScore(rdy) >= READINESS_QS.length && readinessScore(rdy) <= READY_LOW_MAX) ||
        readinessFlagAnswer(rdy) === 1);
    let min = Infinity;
    for (const s of entry.sets.slice(0, need)) {
      if (s.skipped) return { logged: true, min: null, rir, protect, date: entry.date }; // skipped set = a real miss
      if ((parseFloat(s.weight) || 0) < effWeight - 0.01) return { logged: true, min: null, rir, protect, date: entry.date };
      min = Math.min(min, parseInt(s.reps, 10) || 0);
    }
    return { logged: true, min, rir, protect, date: entry.date };
  }

  // Stall reset: hand back the earned weight at the coach's %, rounded down to
  // a real increment, and re-climb from the rep floor. The WRITTEN weight is a
  // hard floor — the chain never deloads below what the coach actually
  // programmed, so a lifter stuck at the starting number keeps counting stalls
  // and stays flagged rather than spiralling downward on its own.
  function progressionBackoff(st, rule, base) {
    // Round down to the ladder's own jump size, so a kg ladder lands back on
    // kg-clean numbers and a lb one on lb-clean ones without knowing which.
    const grain = rule.inc || 5;
    const cut = Math.max(base, Math.floor((st.weight * (1 - rule.backoff / 100)) / grain) * grain);
    const gaveBack = cut < st.weight - 0.01 || st.reps > rule.floor || st.extra > 0;
    st.weight = cut;
    st.reps = rule.floor;
    st.extra = 0;
    if (!gaveBack) return; // nothing left to give back — keep the stall flag up
    st.stall = 0;
    st.deloads += 1;
    st.last = "deload";
  }

  // The one-session pullback's number: pct off the computed target, floored to
  // the ladder's own grain so it lands on plate-clean numbers. Deliberately
  // NOT floored at the written weight the automatic backoff honours: an
  // early-chain athlete sits AT the written weight, and a floor there turns
  // the promised "15% lighter" into 0% exactly when they're struggling most.
  // The offer is coach-authored and athlete-accepted — it may go below the
  // prescription for its one session. Display-only; the chain never sees it.
  function deloadTargetWeight(target, grain, pct) {
    const g = grain || 5;
    return Math.max(g, Math.floor((target * (1 - pct / 100)) / g) * g);
  }

  // ---- Skip-a-day bookkeeping (see 2026-08-11-skip-day-design.md) ----
  // Every date this day was touched — a locked entry on any of its exercises,
  // skip or real — ascending.
  function dayOccurrences(day, logsMap) {
    const dates = new Set();
    (day?.exercises || []).forEach((ex) => {
      (logsMap?.[ex.id] || []).forEach((l) => {
        if (l?.locked && (l.skipped || (Array.isArray(l.sets) && l.sets.length))) dates.add(l.date);
      });
    });
    return [...dates].sort();
  }
  // A date where the athlete recorded the miss and nothing else: at least one
  // skip entry and no exercise with real sets. One logged lift makes the date
  // a session, however short — they showed up.
  function isSkipOccurrence(day, logsMap, date) {
    let sawSkip = false;
    for (const ex of day?.exercises || []) {
      for (const l of logsMap?.[ex.id] || []) {
        if (!l?.locked || l.date !== date) continue;
        if (Array.isArray(l.sets) && l.sets.length && !l.skipped) return false;
        if (l.skipped) sawSkip = true;
      }
    }
    return sawSkip;
  }
  // How many of the day's most recent occurrences are skips, counting back
  // from the latest until a real session breaks the run.
  function consecutiveDaySkips(day, logsMap) {
    const dates = dayOccurrences(day, logsMap);
    let n = 0;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (!isSkipOccurrence(day, logsMap, dates[i])) break;
      n++;
    }
    return n;
  }

  // The pending pullback that should govern the session dated `logDate`.
  // Unconsumed (no .date) it applies to the next session opened; lockIn stamps
  // it with that session's date, after which it applies only to re-edits of
  // the same date — the session after comes back at full weight by itself.
  function dayDeloadPending(day, progress, logDate) {
    const pd = progress?.pendingDeloads?.[day?.id];
    if (!pd) return null;
    if (pd.date && pd.date !== logDate) return null;
    return pd;
  }

  // One week of ladder movement, shared by the bodyweight and weighted chains.
  // `st` is the running ladder state and is mutated in place; `base` is the
  // written weight the back-off may never cut below.
  function progressionStep(st, rule, att, base) {
    if (!att.logged) { st.last = "rest"; return; } // nothing to judge — run intact
    // Which ruleset judges this session. See PROG_RIR_V2_FROM: a log with no
    // date at all falls to the old rules, which are the generous ones.
    const legacy = !att.date || String(att.date) < PROG_RIR_V2_FROM;
    // Effort read against what the set was ASKED to feel like, not a fixed
    // number, so the same tap means one thing at a target of 2 and another at
    // a target of 4.
    const off = att.rir == null ? 0 : att.rir - rule.targetRir;
    const easier = att.rir != null &&
      (legacy ? att.rir >= PROG_RIR_EASY : off >= PROG_RIR_BAND);
    const harder = !legacy && att.rir != null && off <= -PROG_RIR_BAND;

    if (att.min == null || att.min < st.reps) {
      st.easyRun = 0; // a miss ends the run whatever the effort said
      // A miss with plenty left in the tank isn't a strength failure — they
      // stopped early. Hold the target, but don't hold it against them. Same
      // for a miss on a day they checked in beat up: that's a bad night's
      // sleep, not a strength failure. A miss ground out at RIR 0 counts ONCE,
      // like any other: the brake for that athlete is the hold below, which
      // fires a session earlier and costs them nothing.
      if (easier || att.protect) { st.last = "hold"; return; }
      st.stall += 1;
      st.last = "miss";
      if (rule.backoff && st.stall >= rule.stallAfter) progressionBackoff(st, rule, base);
      return;
    }
    st.stall = 0;
    // They hit the reps, but two under target getting there — the number was
    // met, the quality asked for was not. Hold, and say nothing against them:
    // this is the brake the old system never had, and it fires BEFORE the
    // session that would otherwise have been the failure.
    if (harder) { st.easyRun = 0; st.last = "grind"; return; }
    st.easyRun = easier ? st.easyRun + 1 : 0;
    // Acceleration is EARNED, not tapped: two easy sessions in a row, and the
    // run is spent paying out so a long streak pays every other session rather
    // than every one. Legacy sessions keep their single-session double.
    const fast = legacy ? easier : st.easyRun >= PROG_RIR_BAND;
    if (fast && !legacy) st.easyRun = 0;
    if (att.min < rule.ceil) {
      st.reps = Math.min(att.min + rule.step * (fast ? 2 : 1), rule.ceil);
      st.last = "climb";
      return;
    }
    // Topped out. Spend the set leg first, then the weight leg.
    if (st.extra < rule.addSets) { st.extra += 1; st.reps = rule.reset; st.last = "set"; return; }
    // No weight leg to spend (reps-only, or bodyweight that never graduates):
    // the ladder just holds at its ceiling.
    if (rule.repsOnly || (rule.bw && !rule.graduate)) { st.reps = rule.ceil; st.last = "cap"; return; }
    // The WEIGHT leg moves one increment. Reps are the fast lane and they are
    // self-correcting — a rung taken too early has to be hit again next time
    // or the ladder stalls — whereas a doubled jump goes straight onto the bar
    // off one self-reported tap, which is what this rework is for.
    const wBoost = legacy && easier ? 2 : 1;
    st.weight += rule.inc * wBoost;
    st.reps = rule.reset;
    st.extra = 0;
    st.earned += wBoost;
    st.easyRun = 0; // a jump is the payout; the run doesn't survive it
    st.last = "jump";
  }

  function newProgressionState(weight, reps) {
    // easyRun: consecutive sessions logged easier than the target. Walk state
    // like everything else here — never stored, re-derived on every render.
    return { weight, reps, extra: 0, stall: 0, earned: 0, deloads: 0, easyRun: 0, last: null };
  }

  function progressionResult(st, rule, writtenSets, base) {
    return {
      weight: Math.round(st.weight * 100) / 100,
      reps: st.reps,
      // `earned` counts successful weight jumps; `gained` is the lb actually
      // standing above what the coach wrote. They diverge once a back-off hands
      // some of it back, and it's `gained` that the athlete's chip must show.
      earned: st.earned,
      gained: Math.round((st.weight - base) * 100) / 100,
      extra: st.extra,
      sets: writtenSets ? writtenSets + st.extra : 0,
      stall: st.stall,
      deloads: st.deloads,
      justDeloaded: st.last === "deload",
      // Topped out with nothing left to spend. For a band-only lift this is
      // "they have earned the next band" — the card offers it, and the coach
      // still takes it. The engine computes targets; it does not re-prescribe.
      atCap: st.last === "cap",
      // The last session hit its reps but was ground out two under the target
      // effort, so the ladder held rather than climbed. A held target with no
      // reason on screen reads as a bug, so this is here for the card to say
      // so; nothing renders it yet.
      ground: st.last === "grind",
      // How many easy sessions are banked toward the next extra rung. Two
      // earns it; one is worth surfacing as "keep going" if the card ever wants
      // to.
      easyRun: st.easyRun || 0,
      ...rule,
    };
  }

  // Walk this exercise's copies (matched by LIFT — name plus the tags that
  // change what you can lift, so a barbell week and a dumbbell week never
  // chain into each other) in program order up to the
  // given instance, chaining BOTH legs of double progression:
  //   - reps climb: hit every set at ≥ the current rep target → next target =
  //     worst set + 1 (capped at the ceiling);
  //   - weight jump: every set at ≥ the ceiling → +inc lb, reps reset to floor;
  //   - miss (or no locked log) → hold everything.
  // A hand-edited written weight (different from the previous copy's) re-bases
  // the chain, so the coach can deload / jump mid-program by typing a number.
  // Returns { weight, reps, sets, earned, extra, stall, deloads, justDeloaded,
  // floor, ceil, inc, ... } or null when the exercise has no rule.
  // `readyMap` is progress.readiness — optional, and only ever cancels stalls.
  function effectiveProgression(weeks, ex, logsMap, readyMap) {
    const rule = progressionRule(ex);
    if (!rule) return null;
    const name = liftKey(ex);
    if (!name) return null;
    if (rule.bw) {
      // Bodyweight rep ladder: worst set + 1 on a hit. Without graduation it
      // holds at the cap (no weight to jump to). With graduation, hitting the
      // cap on every set adds `inc` lb of load and resets reps, after which the
      // ladder climbs weight like the weighted chain below — while every week's
      // written weight stays "BW". A hand-edited written REPS value re-bases the
      // rep floor (only before graduating), mirroring the weighted chain's
      // re-base on a written-weight edit.
      const st = newProgressionState(0, rule.floor);
      let prevFloor = null;
      for (const w of weeks || []) {
        for (const d of w.days || []) {
          for (const e of d.exercises || []) {
            if (liftKey(e) !== name) continue;
            if (e.currentWeight !== "BW") continue; // ladder only chains BW copies
            const f = parseInt(e.currentReps, 10);
            if (!f) continue;
            if (st.weight === 0 && (prevFloor === null || f !== prevFloor)) {
              st.reps = f; st.extra = 0; st.stall = 0; st.last = null;
            }
            prevFloor = f;
            const wrote = parseInt(e.sets, 10) || 0;
            if (e.id === ex.id) {
              const res = progressionResult(st, rule, wrote, 0);
              return st.weight > 0 ? { ...res, bw: false } : { ...res, weight: null };
            }
            progressionStep(st, rule, progressionAttempt(e, st.weight, wrote + st.extra, logsMap, { dayId: d.id, readyMap }), 0);
          }
        }
      }
      return null;
    }
    const st = newProgressionState(0, rule.floor);
    let base = 0, prevWritten = null;
    for (const w of weeks || []) {
      for (const d of w.days || []) {
        for (const e of d.exercises || []) {
          if (liftKey(e) !== name) continue;
          const written = parseFloat(e.currentWeight);
          if (!isFinite(written)) continue; // skip BW/blank copies
          // A hand-edited written weight re-bases the whole chain, so the coach
          // can deload / jump mid-program by typing a number.
          if (prevWritten === null || written !== prevWritten) {
            base = written;
            st.weight = written; st.reps = rule.floor; st.extra = 0;
            st.stall = 0; st.earned = 0; st.deloads = 0; st.last = null;
          }
          prevWritten = written;
          const wrote = parseInt(e.sets, 10) || 0;
          if (e.id === ex.id) return progressionResult(st, rule, wrote, base);
          progressionStep(st, rule, progressionAttempt(e, st.weight, wrote + st.extra, logsMap, { dayId: d.id, readyMap }), base);
        }
      }
    }
    return null; // instance not found in the given weeks
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.training = Object.assign(NS.training || {}, {
    PROG_NO_CAP, PROG_TIME_STEP, PROG_MAX_ADD_SETS, PROG_STALL_DEFAULT,
    PROG_BACKOFF_PCTS, PROG_STALL_SHOW, PROG_RIR_EASY,
    PROG_RIR_TARGET, PROG_RIR_BAND, PROG_RIR_V2_FROM,
    progressionRule, progressionAttempt, progressionBackoff,
    deloadTargetWeight, dayOccurrences, isSkipOccurrence,
    consecutiveDaySkips, dayDeloadPending,
    progressionStep, newProgressionState, progressionResult,
    effectiveProgression,
  });
})();
