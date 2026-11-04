// Service worker: maakt de app installeerbaar, laat ze openen zonder verbinding (bv. in een stookplaats in de kelder)
// en houdt foto's bij die al eens getoond werden, zodat je ze ook zonder bereik ziet. Eigen bestanden: altijd eerst de nieuwste versie.
const APP = "rookgas-app-v6", FOTOS = "rookgas-fotos-v1";
const BESTANDEN = ["./", "index.html", "app.js", "config.js", "manifest.webmanifest",
  "vendor/supabase-2.116.0.js", "vendor/exceljs-4.4.0.min.js",
  "fonts/barlow-condensed-latin-600-normal.woff2", "fonts/barlow-condensed-latin-700-normal.woff2",
  "fonts/ibm-plex-sans-latin-400-normal.woff2", "fonts/ibm-plex-sans-latin-500-normal.woff2", "fonts/ibm-plex-sans-latin-600-normal.woff2",
  "icons/icoon.svg", "icons/icoon-180.png", "icons/icoon-192.png", "icons/icoon-512.png"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(APP).then((c) => c.addAll(BESTANDEN.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("rookgas-") && k !== APP && k !== FOTOS).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(eerstNetwerk(req));
  else if (url.pathname.includes("/storage/v1/object/sign/")) e.respondWith(foto(url));
});

async function eerstNetwerk(req) {
  const cache = await caches.open(APP);
  const bewaard = () => cache.match(req, { ignoreSearch: true }).then((r) => r || (req.mode === "navigate" ? cache.match("index.html") : null));
  // "no-cache": altijd bij GitHub navragen of er een nieuwere versie is (anders tot 10 min. de oude uit de browsercache).
  const net = fetch(req, { cache: "no-cache" }).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; });
  const traag = new Promise((ok) => setTimeout(ok, 4000));
  try {
    const res = await Promise.race([net, traag.then(() => null)]);
    if (res) return res;
    return (await bewaard()) || await net;
  } catch {
    return (await bewaard()) || Response.error();
  }
}

// Foto's: het adres bevat een tijdelijke sleutel; bewaar ze daarom onder het adres zonder die sleutel.
async function foto(url) {
  const sleutel = url.origin + url.pathname, cache = await caches.open(FOTOS);
  const bewaard = await cache.match(sleutel);
  if (bewaard) return bewaard;
  if (url.searchParams.has("offline")) return Response.error();
  const res = await fetch(url.href, { mode: "cors", credentials: "omit" });
  if (res.ok) cache.put(sleutel, res.clone());
  return res;
}
