const CACHE_PREFIX = "otmetka-attendance-pwa-";
const CACHE_NAME = `${CACHE_PREFIX}shell-v1`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-maskable.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./src/app.js",
  "./src/constants.js",
  "./src/dates.js",
  "./src/model.js",
  "./src/overview.js",
  "./src/storage.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const fallback = await cache.match("./index.html");
        return fallback || fetch(request);
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => cache.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === "opaque") return response;
        const copy = response.clone();
        void cache.put(request, copy);
        return response;
      });
    }))
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "VERIFY_OFFLINE_CACHE") return;
  const responsePort = event.ports?.[0];
  if (!responsePort) return;

  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        const matches = await Promise.all(APP_SHELL.map((url) => cache.match(url)));
        const missing = APP_SHELL.filter((_, index) => !matches[index]);
        responsePort.postMessage({ ok: missing.length === 0, cached: matches.length - missing.length, missing });
      })
      .catch(() => responsePort.postMessage({ ok: false, cached: 0 }))
  );
});
