/* Stone Dragon — offline service worker.
 *
 * Goal: an installed athlete can open the app and follow their program with
 * NO network. Program/progress data already lives in localStorage; this makes
 * the app shell (HTML/CSS/JS + the Supabase CDN lib) load offline too.
 *
 * Strategy:
 *   - Navigations (the HTML page): network-first, fall back to cached shell.
 *     So when online you always boot the latest deploy; offline you boot the
 *     last cached copy.
 *   - Same-origin assets + the Supabase CDN: cache-first, keyed by full URL.
 *     The app's `?v=` cache-busting means a new deploy = a new URL = a cache
 *     miss = a fresh fetch, so cache-first never serves stale versioned code.
 *   - Everything else (Supabase API calls to *.supabase.co, etc.): untouched —
 *     passes straight to the network and fails gracefully offline, exactly as
 *     before. We never cache API data.
 *
 * Updates: bump CACHE on any change here; old caches are purged on activate,
 * and skipWaiting + clients.claim make the new worker take over promptly.
 * Because navigations are network-first, a fresh deploy is picked up on the
 * next online open automatically — no user prompt.
 */
const CACHE = "stonedragon-v3";

// Stable, un-versioned URLs worth precaching up front. The versioned css/js
// (styles.css?v=…, app.js?v=…) are cached at runtime on first online load —
// intentionally NOT hardcoded here so this file never drifts out of sync with
// index.html's ?v= values.
const CORE = [
  "./",
  "./index.html",
  "./manifest.json",
  "./logo-192.png",
  "./logo-512.png",
  "./icon-192.svg",
  "./icon-512.svg",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
];

// Parse index.html and precache the versioned js/css it references, so a
// first-time visitor who goes offline immediately (before any reload) still
// has the real app-shell assets cached. We read the URLs out of the HTML
// instead of hardcoding ?v= values here, so this file never drifts from
// index.html on deploys. (Service workers have no DOMParser, hence the regex.)
async function precacheShellAssets(cache) {
  try {
    const res = await fetch("./index.html", { cache: "no-cache" });
    const html = await res.text();
    const urls = new Set();
    const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html))) {
      if (/\.(?:js|css)(?:\?|$)/i.test(m[1])) {
        urls.add(new URL(m[1], self.location.href).href);
      }
    }
    await Promise.allSettled([...urls].map((u) => cache.add(u)));
  } catch (err) {
    // Offline during install — runtime caching backfills these on next visit.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // add() each individually so one failure (e.g. a transient CDN hiccup)
      // doesn't abort the whole precache like cache.addAll would.
      .then(async (cache) => {
        await Promise.allSettled(CORE.map((u) => cache.add(u)));
        await precacheShellAssets(cache);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    cache.put(request, res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await cache.match("./index.html");
    if (shell) return shell;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  // Cache successful same-origin responses and opaque cross-origin (CDN) ones.
  if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache POST/PATCH (Supabase writes)

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCDN = url.href.startsWith("https://cdn.jsdelivr.net/");

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }
  if (sameOrigin || isCDN) {
    event.respondWith(cacheFirst(req));
    return;
  }
  // Anything else (Supabase REST/auth, etc.): leave alone — default network.
});

// -------- Web push --------
// Payload is JSON from the send-push Edge Function: { title, body, url }.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Stone Dragon Strength", {
      body: data.body || "",
      icon: "./logo-192.png",
      badge: "./logo-192.png",
      data: { url: data.url || "./" },
    })
  );
});

// Tap → focus an open app window, or open one at the notification's url.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.location.href).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return clients.openWindow(url);
    })
  );
});
