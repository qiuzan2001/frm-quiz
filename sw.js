// sw.js — 界面文件网络优先（3 秒超时退回缓存）；CDN 库缓存优先；api.github.com 不经过这里
const CACHE = "frm-quiz-v2";
const NET_TIMEOUT = 3000;
const SHELL = [
  "./", "./index.html", "./style.css", "./logic.js", "./store.js", "./github.js", "./app.js",
  "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
  "https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/contrib/auto-render.min.js",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== "frm-images").map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.hostname === "api.github.com") return;
  const cacheable = url.origin === self.location.origin || url.hostname === "cdnjs.cloudflare.com";
  if (!cacheable) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request);
    if (url.hostname === "cdnjs.cloudflare.com") {
      return hit || fetch(e.request).then(async (res) => { if (res.ok) await c.put(e.request, res.clone()); return res; });
    }
    const net = fetch(e.request, { cache: "no-cache" }).then(async (res) => { if (res.ok) await c.put(e.request, res.clone()); return res; });
    if (!hit) return net;
    e.waitUntil(net.catch(() => {}));
    const timeout = new Promise((resolve) => setTimeout(() => resolve(hit), NET_TIMEOUT));
    return Promise.race([net.then((res) => (res.ok ? res : hit)).catch(() => hit), timeout]);
  }));
});
