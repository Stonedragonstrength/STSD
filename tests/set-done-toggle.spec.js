// @vitest-environment jsdom
//
// The set row's ✓ circle: un-marking a done set must KEEP the numbers.
//
// The bug this guards (2026-08-19): the ✓'s off-action was `wt.value = "";
// rp.value = ""` — "one tap to undo" the tap-to-accept. But to an athlete the
// circle reads as a per-row lock, and tapping it to unlock-and-edit wiped the
// numbers they had typed back to the prescription placeholders; the 800ms
// draft save then deleted the whole entry. On a 1-set exercise that was the
// entire log, gone. Un-marking now sets a transient `unchecked` flag on the
// row item instead: the circle empties, the fill line drops, and the numbers
// stay in the fields (Tools > Clear remains the eraser).
//
// Extracts the real setDoneNow / mkDoneBtn out of app.js — not a re-code of
// them (tests/README.md: a copy would go green while the shipped app is dead).
import { describe, it, expect, vi } from "vitest";
import { loadFns } from "./helpers/load-fn.js";

function build({ restAutoStart = false } = {}) {
  const autoSave = vi.fn();
  const startRestTimer = vi.fn();
  const fns = loadFns(["const setDoneNow =", "const mkDoneBtn ="], {
    repsOnlyLog: false,
    isLocked: false,
    doneSyncs: [],
    markEdited: (input) => input.classList.toggle("edited", input.value !== ""),
    autoSave,
    startRestTimer,
    restAutoStartOn: () => restAutoStart,
    restDur: () => 60,
  });
  return { ...fns, autoSave, startRestTimer };
}

function mkItem(wtVal = "", rpVal = "") {
  const wt = document.createElement("input");
  const rp = document.createElement("input");
  wt.value = wtVal;
  rp.value = rpVal;
  return { wt, rp, skipped: false };
}

describe("set-row ✓ toggle", () => {
  it("un-marking a done set keeps the typed numbers and reads not-done", () => {
    const { setDoneNow, mkDoneBtn } = build();
    const item = mkItem("145", "6");
    const btn = mkDoneBtn(item, () => ({ w: 135, r: 8 }));
    expect(setDoneNow(item)).toBeTruthy();

    btn.click();

    expect(item.wt.value).toBe("145");
    expect(item.rp.value).toBe("6");
    expect(setDoneNow(item)).toBeFalsy();
  });

  it("re-tapping an un-marked set makes it done again, numbers intact", () => {
    const { setDoneNow, mkDoneBtn } = build();
    const item = mkItem("145", "6");
    const btn = mkDoneBtn(item, () => ({ w: 135, r: 8 }));

    btn.click(); // off
    btn.click(); // back on

    expect(item.wt.value).toBe("145");
    expect(item.rp.value).toBe("6");
    expect(setDoneNow(item)).toBeTruthy();
  });

  it("tapping an empty set still accepts the prescription and rolls rest", () => {
    const { setDoneNow, mkDoneBtn, startRestTimer } = build({ restAutoStart: true });
    const item = mkItem();
    const btn = mkDoneBtn(item, () => ({ w: 135, r: 8 }));

    btn.click();

    expect(item.wt.value).toBe("135");
    expect(item.rp.value).toBe("8");
    expect(setDoneNow(item)).toBeTruthy();
    expect(startRestTimer).toHaveBeenCalled();
  });
});
