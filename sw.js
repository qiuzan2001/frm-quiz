// sw.js — 界面文件与 CDN 库缓存优先；api.github.com 不经过这里
const CACHE = "frm-quiz-v1";
const SHELL = [
  "./", "./index.html", "./style.css", "./logic.js", "./store.js", "./github.js", "./app.js",
  "./manifest.webmanifest", "./icon.svg",
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
    const net = fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; });
    if (url.hostname === "cdnjs.cloudflare.com") return hit || net;
    e.waitUntil(net.catch(() => {}));
    return hit || net;
  }));
});
