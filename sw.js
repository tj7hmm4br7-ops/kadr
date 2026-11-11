// Сервис-воркер: игра открывается как приложение, а уже загруженные кадры и постеры берутся из памяти телефона
const V = "kadr-v2";
const IMG = "kadr-img-v1";
const CORE = ["./", "index.html", "manifest.webmanifest", "icon.svg?v=c7", "icon-192.png?v=c7", "apple-touch-icon.png?v=c7"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== V && k !== IMG).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Сначала сеть (чтобы обновления приходили сразу), без сети — сохранённая копия
async function networkFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key || req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(key || req);
    if (hit) return hit;
    throw e;
  }
}
// Кадры и постеры не меняются — берём из памяти, если уже скачаны
async function cacheFirst(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // TMDB, Firebase, шрифты — как обычно
  const path = url.pathname;
  if (req.mode === "navigate") { e.respondWith(networkFirst(req, V, "index.html")); return; }
  if (path.includes("/img/")) { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(networkFirst(req, V));
});
