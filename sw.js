// Сервис-воркер: игра открывается как приложение, а уже загруженные кадры и постеры берутся из памяти телефона.
// Если GitHub тормозит или недоступен, через несколько секунд открываем сохранённую копию сайта.
const V = "kadr-v3";
const IMG = "kadr-img-v1";
const WAIT = 3500; // сколько ждём сеть, прежде чем показать сохранённую копию
const CORE = ["./", "index.html", "data/films.json", "manifest.webmanifest?v=c7", "icon.svg?v=c7", "icon-192.png?v=c7", "apple-touch-icon.png?v=c7"];

self.addEventListener("install", e => {
  // не падаем, если какой-то файл не скачался: сохраняем то, что получилось
  e.waitUntil(caches.open(V).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== V && k !== IMG).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Сначала сеть, чтобы обновления приходили сразу. Если сеть молчит дольше WAIT или упала — сохранённая копия.
// Ответ сети, пришедший позже, всё равно обновит копию для следующего раза.
async function networkFirst(e, cacheName, key) {
  const req = e.request;
  const cache = await caches.open(cacheName);
  const net = fetch(req).then(res => {
    if (res.ok && !res.redirected) cache.put(key || req, res.clone());
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  const hit = await cache.match(key || req, { ignoreSearch: req.mode === "navigate" });
  if (!hit) return net; // сохранённой копии нет — ждём сеть сколько потребуется
  const timeout = new Promise(res => setTimeout(() => res(hit), WAIT));
  return Promise.race([net.catch(() => hit), timeout]);
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
  if (url.origin !== location.origin) return; // Firebase, шрифты — как обычно
  if (req.mode === "navigate") { e.respondWith(networkFirst(e, V, "index.html")); return; }
  if (url.pathname.includes("/img/")) { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(networkFirst(e, V, url.pathname.endsWith("/data/films.json") ? "data/films.json" : null));
});
