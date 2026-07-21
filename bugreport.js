/* ============ Stone Dragon — bug diagnostics recorder ============
 *
 * Loads before cloud.js/app.js so even boot errors get caught. Silently keeps
 * small ring buffers of JS errors, console warnings, and recent taps; the
 * "Report a problem" flow in app.js calls BugReport.snapshot() to attach them
 * to a bug_reports row. Never records input values, passwords, or log data —
 * only error text, element labels, and device basics.
 */
(function () {
  "use strict";

  const MAX_ERRORS = 25;
  const MAX_CONSOLE = 40;
  const MAX_TAPS = 30;
  const KEY_LAST_ERRORS = "trainerpro_last_errors_v1";

  const startedAt = Date.now();
  const errors = [];
  const consoleLog = [];
  const taps = [];

  // Errors persisted by the previous session (survive a crash + reload).
  let prevSession = null;
  try {
    const raw = localStorage.getItem(KEY_LAST_ERRORS);
    if (raw) prevSession = JSON.parse(raw);
  } catch (e) { /* ignore */ }
  try { localStorage.removeItem(KEY_LAST_ERRORS); } catch (e) { /* ignore */ }

  function ts() {
    const d = new Date();
    const p = (n, w) => String(n).padStart(w || 2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  }
  function push(arr, max, item) {
    arr.push(item);
    if (arr.length > max) arr.shift();
  }
  function trunc(s, n) {
    s = String(s == null ? "" : s);
    return s.length > n ? s.slice(0, n) + "…" : s;
  }
  // Best-effort persist so a hard crash right after an error still leaves a trail.
  let persistTimer = null;
  function persistErrors() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY_LAST_ERRORS, JSON.stringify({
          at: new Date().toISOString(),
          errors: errors.slice(-10),
        }));
      } catch (e) { /* storage full — nothing to do */ }
    }, 250);
  }

  function recordError(entry) {
    push(errors, MAX_ERRORS, entry);
    persistErrors();
  }

  window.addEventListener("error", (e) => {
    // Resource load failures (img/script) surface here too, with a target.
    if (e.target && e.target !== window && (e.target.src || e.target.href)) {
      recordError({ t: ts(), kind: "resource", msg: `Failed to load ${trunc(e.target.src || e.target.href, 200)}` });
      return;
    }
    recordError({
      t: ts(), kind: "error",
      msg: trunc(e.message, 300),
      src: e.filename ? `${trunc(e.filename.split("/").pop(), 60)}:${e.lineno}:${e.colno}` : "",
      stack: trunc(e.error && e.error.stack, 700),
    });
  }, true);

  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    recordError({
      t: ts(), kind: "rejection",
      msg: trunc(r && (r.message || r), 300),
      stack: trunc(r && r.stack, 700),
    });
  });

  // Mirror console.warn/error into the buffer (cloud.js failures land here).
  for (const level of ["warn", "error"]) {
    const orig = console[level].bind(console);
    console[level] = function (...args) {
      try {
        const msg = args.map((a) => {
          if (typeof a === "string") return a;
          try { return JSON.stringify(a); } catch (e) { return String(a); }
        }).join(" ");
        push(consoleLog, MAX_CONSOLE, { t: ts(), level, msg: trunc(msg, 300) });
      } catch (e) { /* never break console */ }
      orig(...args);
    };
  }

  // Tap breadcrumbs: which control was pressed, never what was typed.
  function visibleScreen() {
    for (const id of ["screen-login", "screen-app", "screen-client"]) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains("hidden")) return id.replace("screen-", "");
    }
    return "?";
  }
  document.addEventListener("click", (e) => {
    const el = e.target && e.target.closest
      ? e.target.closest("button, a, .tab, .coach-nav-item, [role=button]")
      : null;
    if (!el) return;
    const label = el.id ? "#" + el.id
      : trunc((el.textContent || "").trim().replace(/\s+/g, " "), 40)
        || trunc(el.className, 40);
    push(taps, MAX_TAPS, { t: ts(), on: visibleScreen(), el: label });
  }, true);

  function appVersion() {
    const s = document.querySelector('script[src^="app.js"]');
    const m = s && s.src.match(/\?v=([\w.-]+)/);
    return m ? m[1] : "unknown";
  }

  function snapshot() {
    let storage = {};
    try {
      storage = {
        trainerBytes: (localStorage.getItem("trainerpro_data_v1") || "").length,
        clientBytes: (localStorage.getItem("trainerpro_client_v1") || "").length,
      };
    } catch (e) { /* ignore */ }
    return {
      version: appVersion(),
      url: trunc(location.href, 200),
      userAgent: navigator.userAgent,
      screen: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio || 1}x`,
      standalone: !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches),
      online: navigator.onLine,
      cloudEnabled: !!(window.Cloud && window.Cloud.enabled),
      visibleScreen: visibleScreen(),
      sessionAgeSec: Math.round((Date.now() - startedAt) / 1000),
      reportedAt: new Date().toISOString(),
      storage,
      errors: errors.slice(),
      console: consoleLog.slice(),
      taps: taps.slice(),
      prevSessionErrors: prevSession,
    };
  }

  window.BugReport = { snapshot };
})();
