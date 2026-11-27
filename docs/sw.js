// Life OS service worker: keeps the app shell on the phone so it opens instantly, even offline (on a flight too).
const CACHE = "lifeos-v26";
const SHELL = ["./", "index.html", "app.css", "app.js", "config.js", "aurora.jpg", "manifest.webmanifest", "icon-180.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js"];
const CDN = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
const keep = (req, r) => { if (r && (r.ok || r.type === "opaque")){ const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; };
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Library and fonts: versioned, so the cached copy first, the network only when it's missing.
  if (CDN.includes(u.hostname)){ e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => keep(e.request, r)))); return; }
  if (u.origin !== location.origin) return;
  // The app itself: network first so updates land, but give up after 3 s (plane wifi) and use the cached copy.
  const net = fetch(e.request, {cache:"no-cache"}).then(r => keep(e.request, r));
  const slow = new Promise((_, no) => setTimeout(() => no(new Error("slow")), 3000));
  e.respondWith(Promise.race([net, slow]).catch(() => caches.match(e.request).then(m => m || caches.match("index.html") || net)));
});
