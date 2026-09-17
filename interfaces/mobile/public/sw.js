/*
 * Nobi mobile — service worker.
 *
 * Makes the mobile client installable (Add to Home Screen) and keeps the app
 * shell available offline. It is deliberately conservative about what it caches:
 *
 *   • App shell (HTML/JS/CSS/icons, same-origin GET) → stale-while-revalidate,
 *     so the UI opens instantly and updates in the background.
 *   • /api/*  and  /api/ws  (the live brain + WebSocket) → NEVER cached; always
 *     hits the network. Nobi's answers, pairing, and voice are always live.
 *   • Navigations that fail offline → fall back to the cached shell so the app
 *     still boots and can show a "can't reach your Nobi" state in-app.
 *
 * Bump CACHE_VERSION to force old caches out on the next visit.
 */
const CACHE_VERSION = "neura-mobile-v1";
const SCOPE_PATH = new URL(self.registration.scope).pathname; // e.g. "/mobile/"

// Core shell to warm on install. Hashed JS/CSS are picked up at runtime.
const PRECACHE = [
  SCOPE_PATH,
  SCOPE_PATH + "manifest.json",
  SCOPE_PATH + "favicon.svg",
  SCOPE_PATH + "icon-192.png",
  SCOPE_PATH + "icon-512.png",
  SCOPE_PATH + "apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

// Let the page tell a waiting worker to activate immediately.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isApi(url) {
  return url.pathname.includes("/api/") || url.pathname.endsWith("/api");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never cache POST/chat/etc.

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (fonts/CDN) pass through
  if (isApi(url)) return; // live brain + WebSocket upgrade → network only

  // Navigations: network-first, fall back to the cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(SCOPE_PATH).then((r) => r || caches.match(req)),
      ),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    ),
  );
});
