// Extracted from cloud.js — the deliberately DEFERRED brick, second half
// (design doc §5: the push queue was held to the very end of the programme,
// because a duplicated singleton makes its guarantees a no-op with no
// error). See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/sync/push-queue.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// THE SINGLETON RULE (§4 rule 3): the queue's timers, sequence numbers and
// in-flight count live in ONE closure, and a writer and a reader in
// different call stacks must see the same cells. The factory below holds
// the bodies verbatim from cloud.js; the module constructs THE instance
// exactly once at load, cloud.js pulls that instance at the top of its
// IIFE, and nothing else may ever construct another for the app. The
// factory is exported for one purpose only: the spec builds isolated
// queues from the same shipped code.
(function () {
  "use strict";

  function makePushQueue() {
  // -------- Debounce helper --------
  // Stores the pending fn alongside its timer so callers can force it to run
  // immediately via flush() (e.g. a Save button or when the page is hidden),
  // instead of waiting out the debounce window and risking loss on close.
  //
  // Instrumented for the sync-status chip: every queue/fire/settle transition
  // reports through onSyncActivity, and a failed push is a REPORTED state now
  // rather than a console line nobody reads. pendingPushes() counts both the
  // queued (timer not fired) and the in-flight (fired, unsettled) pushes, so
  // "everything is saved" can only be claimed when it is true.
  const _debounceTimers = new Map(); // key -> { timer, fn, seq }
  const _pushSeq = new Map();        // key -> the newest push issued for it
  const _retryAttempts = new Map();  // key -> consecutive failures, reset on success
  let _inflightPushes = 0;
  let _pushFailedAt = 0;
  let _syncCb = null;
  // Backoff for a push that failed. A failed push used to be DROPPED: the timer
  // had already fired and deleted the queue entry, so the function was gone —
  // nothing to flush, nothing for "Sync issue. Tap to retry" to retry, and on
  // the progress path `_progressDirtyAt` (app.js:294) stayed set forever, which
  // made the device refuse every pull AND every realtime event for the rest of
  // the session. Silent, and only a reload cleared it.
  const RETRY_MS = [5000, 15000, 45000, 120000];
  function onSyncActivity(cb) { _syncCb = typeof cb === "function" ? cb : null; }
  function pendingPushes() { return _debounceTimers.size + _inflightPushes; }
  function lastPushFailureAt() { return _pushFailedAt; }
  function _sync(evt) {
    if (!_syncCb) return;
    try { _syncCb(evt, pendingPushes()); } catch (e) { /* the chip must never break a push */ }
  }
  // Put a failed push back on the queue so flush() and the retry chip have
  // something to act on, and so reconnecting picks it up.
  function _requeue(key, fn, seq) {
    if (!key) return;                                  // a keyless direct push has no identity to retry under
    if ((_pushSeq.get(key) || 0) !== seq) return;      // superseded: a newer push for this key writes newer state
    // Offline is not a failed attempt, it is a wait. Burning the four attempts
    // against a plane or a lift with no signal would drop the work exactly
    // where the retry matters most, so hold at the longest interval instead and
    // let the `online` handler's flush fire it the moment there is a network.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    let wait;
    if (offline) {
      wait = RETRY_MS[RETRY_MS.length - 1];
    } else {
      const n = (_retryAttempts.get(key) || 0) + 1;
      if (n > RETRY_MS.length) return;                 // given up; _pushFailedAt keeps the chip red
      _retryAttempts.set(key, n);
      wait = RETRY_MS[n - 1];
    }
    const timer = setTimeout(() => {
      _debounceTimers.delete(key);
      _runPush(fn, key, seq);
    }, wait);
    _debounceTimers.set(key, { timer, fn, seq });
    _sync("queued");
  }
  function _runPush(fn, key, seq) {
    _inflightPushes++;
    _sync("push-start");
    return Promise.resolve(fn())
      .then((r) => { _pushFailedAt = 0; if (key) _retryAttempts.delete(key); return r; })
      .catch((e) => {
        _pushFailedAt = Date.now();
        console.warn("[Cloud] push failed", e);
        _requeue(key, fn, seq);
      })
      .finally(() => { _inflightPushes--; _sync("push-settled"); });
  }
  function debounce(key, fn, ms = 1500) {
    const prev = _debounceTimers.get(key);
    if (prev) clearTimeout(prev.timer);
    // A fresh push for this key supersedes anything older, including a retry
    // still waiting: it carries newer state, and it earns a clean set of
    // attempts.
    const seq = (_pushSeq.get(key) || 0) + 1;
    _pushSeq.set(key, seq);
    _retryAttempts.delete(key);
    const timer = setTimeout(() => {
      _debounceTimers.delete(key);
      _runPush(fn, key, seq);
    }, ms);
    _debounceTimers.set(key, { timer, fn, seq });
    _sync("queued");
  }
  // Immediately run any pending debounced calls (optionally only those whose key
  // starts with keyPrefix). Resolves once all have settled — settled, not
  // succeeded: individual failures are recorded in lastPushFailureAt(), and
  // callers that intend to PULL after a flush must check it before treating
  // local state as fully synced (see resyncNow in app.js).
  async function flush(keyPrefix) {
    const entries = [..._debounceTimers.entries()]
      .filter(([k]) => !keyPrefix || k.startsWith(keyPrefix));
    await Promise.all(entries.map(async ([k, entry]) => {
      clearTimeout(entry.timer);
      _debounceTimers.delete(k);
      // Carry the key and seq through, or a push that fails DURING a flush is
      // dropped exactly the way every failed push used to be — and a flush is
      // what runs when the coach leaves a screen or closes the tab, which is
      // the worst possible moment to lose one silently.
      await _runPush(entry.fn, k, entry.seq);
    }));
  }

    return { RETRY_MS, onSyncActivity, pendingPushes, lastPushFailureAt, debounce, flush };
  }

  // THE instance. Constructed here, once, at load.
  const pushQueue = makePushQueue();

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.sync = Object.assign(NS.sync || {}, { pushQueue, makePushQueue });
})();
