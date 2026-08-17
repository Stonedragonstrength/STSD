// The push queue's retry behaviour.
//
// What this is for: a push that fails must not be lost. Before this, the
// debounce timer had already fired and deleted the queue entry by the time the
// push ran, so a failure dropped the function on the floor. Three things
// followed, all silent:
//   - flush() found nothing to flush, so "Sync issue. Tap to retry" retried
//     nothing;
//   - `_progressDirtyAt` (app.js:294) is cleared only by a SUCCESSFUL progress
//     push, so it stayed set forever, and every reader of it — resyncNow at
//     :335 and the realtime progress handler at :453 — bails while it is set.
//     One failed push therefore stopped the device accepting any cloud data
//     for the rest of the session;
//   - nothing was logged beyond a console warning nobody reads.
//
// So these assert what the queue is FOR, not what it did: work handed to it is
// either delivered or still visibly pending, never quietly dropped.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadFns } from "../helpers/load-fn.js";

// The queue's state and functions share one closure in cloud.js, so they have
// to be rebuilt into one scope together. State first: `const`/`let` do not
// hoist, and a function that ran before them would see a dead zone.
const DECLS = [
  "const _debounceTimers = new Map()",
  "const _pushSeq = new Map()",
  "const _retryAttempts = new Map()",
  "let _inflightPushes = 0",
  "let _pushFailedAt = 0",
  "let _syncCb = null",
  "const RETRY_MS = [",
  "function onSyncActivity(",
  "function pendingPushes(",
  "function lastPushFailureAt(",
  "function _sync(",
  "function _requeue(",
  "function _runPush(",
  "function debounce(",
  "async function flush(",
];

const EXPOSE = ["onSyncActivity", "pendingPushes", "lastPushFailureAt", "debounce", "flush", "RETRY_MS"];

function makeQueue({ online = true } = {}) {
  return loadFns(DECLS, {
    // Injected so a test can go offline; shadows the real global inside the
    // rebuilt scope only.
    navigator: { onLine: online },
    // The queue logs a warning on every failure; these tests cause a lot of
    // them on purpose and the output is not the subject.
    console: { warn() {}, log() {}, error() {} },
  }, { file: "cloud.js", expose: EXPOSE });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A push function that fails its first `failures` calls, then succeeds. */
function flaky(failures) {
  let calls = 0;
  const fn = () => {
    calls++;
    return calls <= failures ? Promise.reject(new Error("network")) : Promise.resolve("ok");
  };
  fn.calls = () => calls;
  return fn;
}

describe("the push queue: delivery", () => {
  it("runs a queued push once when it succeeds, and never again", async () => {
    const q = makeQueue();
    const fn = flaky(0);
    q.debounce("progress:a", fn);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fn.calls()).toBe(1);
    // Nothing left pending, and no failure recorded: this is what lets the
    // chip claim everything is saved.
    expect(q.pendingPushes()).toBe(0);
    expect(q.lastPushFailureAt()).toBe(0);

    await vi.advanceTimersByTimeAsync(600000);
    expect(fn.calls()).toBe(1);
  });

  it("retries a push that failed, instead of dropping it", async () => {
    const q = makeQueue();
    const fn = flaky(1); // fails once, then succeeds
    q.debounce("progress:a", fn);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fn.calls()).toBe(1);
    expect(q.lastPushFailureAt()).toBeGreaterThan(0);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fn.calls()).toBe(2);
    // Delivered: the failure stamp clears, so the chip stops saying "sync issue"
    // and — the point of the whole thing — `_progressDirtyAt` gets cleared by
    // the app-side callback, which unblocks pulls again.
    expect(q.lastPushFailureAt()).toBe(0);
    expect(q.pendingPushes()).toBe(0);
  });

  it("counts a waiting retry as pending work", async () => {
    // "Everything is saved" must not be claimable while a retry is queued.
    const q = makeQueue();
    q.debounce("progress:a", flaky(99));
    await vi.advanceTimersByTimeAsync(1500);
    expect(q.pendingPushes()).toBe(1);
  });

  it("backs off, so a broken connection is not hammered", async () => {
    const q = makeQueue();
    const fn = flaky(99);
    q.debounce("progress:a", fn);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fn.calls()).toBe(1);

    // The intervals are the contract; a test that just says "it retries"
    // would pass on a tight loop.
    for (const [i, wait] of q.RETRY_MS.entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(fn.calls(), `should not have retried before ${wait}ms`).toBe(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fn.calls(), `should have retried at ${wait}ms`).toBe(i + 2);
    }
  });

  it("gives up after its attempts, and leaves the failure visible", async () => {
    // An unbounded retry would spin forever on a push that can never succeed
    // (a rejected payload, a revoked token). Stopping is right; stopping
    // QUIETLY is not — lastPushFailureAt keeps the chip red.
    const q = makeQueue();
    const fn = flaky(99);
    q.debounce("progress:a", fn);
    await vi.advanceTimersByTimeAsync(1500 + q.RETRY_MS.reduce((a, b) => a + b, 0));
    expect(fn.calls()).toBe(1 + q.RETRY_MS.length);

    await vi.advanceTimersByTimeAsync(3600000);
    expect(fn.calls(), "must stop retrying").toBe(1 + q.RETRY_MS.length);
    expect(q.lastPushFailureAt(), "but the failure must stay visible").toBeGreaterThan(0);
    expect(q.pendingPushes()).toBe(0);
  });
});

describe("the push queue: staleness", () => {
  it("lets a newer push supersede a retry still waiting", async () => {
    // The hazard a naive retry creates: push A fails and is re-queued; the user
    // edits again and push B is queued with newer state. If A's retry then
    // fires it writes the OLDER state over the newer one. B must win.
    const q = makeQueue();
    const a = flaky(99);
    const b = flaky(0);
    q.debounce("progress:x", a);
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.calls()).toBe(1);
    // There must genuinely BE a retry waiting, or the rest of this test proves
    // nothing: with no retry at all, "the stale push never ran again" is true
    // for the wrong reason. (Confirmed — this line is what makes the test fail
    // when the re-queue is disabled.)
    expect(q.pendingPushes(), "a retry should be waiting to be superseded").toBe(1);

    q.debounce("progress:x", b); // newer state for the same record
    await vi.advanceTimersByTimeAsync(1500);
    expect(b.calls()).toBe(1);

    await vi.advanceTimersByTimeAsync(600000);
    expect(a.calls(), "the stale push must never run again").toBe(1);
    expect(b.calls()).toBe(1);
  });

  it("gives a newer push a full set of attempts", async () => {
    // Retry budget belongs to an attempt at delivering some state, not to the
    // key forever. Fresh state deserves a fresh budget.
    const q = makeQueue();
    q.debounce("progress:x", flaky(99));
    await vi.advanceTimersByTimeAsync(1500 + 5000 + 15000); // burn two attempts

    const later = flaky(99);
    q.debounce("progress:x", later);
    await vi.advanceTimersByTimeAsync(1500);
    expect(later.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000); // the FIRST interval again, not the third
    expect(later.calls()).toBe(2);
  });

  it("keeps separate records independent", async () => {
    const q = makeQueue();
    const bad = flaky(99);
    const good = flaky(0);
    q.debounce("progress:a", bad);
    q.debounce("athlete:b", good);
    await vi.advanceTimersByTimeAsync(1500);
    expect(bad.calls()).toBe(1);
    expect(good.calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(bad.calls()).toBe(2);
    expect(good.calls(), "one record's failure must not retry another").toBe(1);
  });
});

describe("the push queue: recovery", () => {
  it("flush() runs a waiting retry immediately", async () => {
    // This is what makes "Sync issue. Tap to retry" mean something: the chip
    // calls resyncNow(true) -> Cloud.flush(). Before the retry existed there
    // was nothing queued for flush to find, so the button was decorative.
    const q = makeQueue();
    const fn = flaky(1);
    q.debounce("progress:a", fn);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fn.calls()).toBe(1);
    expect(q.pendingPushes()).toBe(1);

    await q.flush(); // no waiting for the backoff
    expect(fn.calls()).toBe(2);
    expect(q.lastPushFailureAt()).toBe(0);
    expect(q.pendingPushes()).toBe(0);
  });

  it("flush() can target one record's retry by key prefix", async () => {
    const q = makeQueue();
    const a = flaky(1);
    const b = flaky(1);
    q.debounce("progress:a", a);
    q.debounce("athlete:b", b);
    await vi.advanceTimersByTimeAsync(1500);

    await q.flush("progress:");
    expect(a.calls()).toBe(2);
    expect(b.calls()).toBe(1);
  });

  it("does not spend its attempts while the device is offline", async () => {
    // Offline is a wait, not a failure. Burning four attempts in three minutes
    // against a gym with no signal would drop the work exactly where the retry
    // matters most — so it holds, and the `online` handler's flush delivers it.
    const q = makeQueue({ online: false });
    const fn = flaky(99);
    q.debounce("progress:a", fn);
    await vi.advanceTimersByTimeAsync(1500);
    expect(fn.calls()).toBe(1);

    // Well past the point where an online queue would have given up.
    await vi.advanceTimersByTimeAsync(1800000);
    expect(q.pendingPushes(), "the work must still be queued").toBe(1);
    expect(fn.calls(), "and it must keep trying rather than give up").toBeGreaterThan(2);
  });

  it("reports every queue transition, so the chip can show the truth", async () => {
    const q = makeQueue();
    const seen = [];
    q.onSyncActivity((evt, pending) => seen.push([evt, pending]));
    q.debounce("progress:a", flaky(1));
    await vi.advanceTimersByTimeAsync(1500);
    // queued -> push-start -> (fails, re-queues) queued -> push-settled
    expect(seen.map(([e]) => e)).toContain("queued");
    expect(seen.map(([e]) => e)).toContain("push-start");
    expect(seen.map(([e]) => e)).toContain("push-settled");
    // The re-queue must announce itself too, or the chip goes green between
    // the failure and the retry.
    expect(seen.filter(([e]) => e === "queued").length).toBeGreaterThan(1);
  });
});
