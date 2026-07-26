import { defineConfig, type Plugin } from "vite";
import { readdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf-8"));
const BUILD_DATE = new Date().toISOString().slice(0, 10);

// Generate a service worker that precaches all built assets + templates for offline use.
function swPlugin(): Plugin {
  return {
    name: "sw-precache",
    apply: "build",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      if (!existsSync(dist)) return;
      const assets: string[] = [];
      const walk = (dir: string, base = "") => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const rel = base ? `${base}/${e.name}` : e.name;
          if (e.name === "sw.js") continue;
          if (e.isDirectory()) walk(resolve(dir, e.name), rel);
          else assets.push("./" + rel);
        }
      };
      walk(dist);
      const CACHE = "monthend-" + Date.now();
      // Offline-first service worker. Once installed the app must keep working
      // with no network at all — the user is at sea for days at a time — so:
      //  • precaching is per-asset, never cache.addAll (one failed request
      //    would otherwise reject the whole install and leave NO cache);
      //  • navigations are served from the cached index.html straight away and
      //    only fall back to the network, so a dead connection never produces
      //    the browser's "you're offline" page;
      //  • the new worker takes over immediately (skipWaiting + clients.claim).
      const sw = `
const CACHE = ${JSON.stringify(CACHE)};
const ASSETS = ${JSON.stringify(assets)};
const INDEX = "./index.html";

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Per-asset so one bad response can't abort the whole precache.
    await Promise.all(ASSETS.map(async (url) => {
      try {
        const resp = await fetch(url, { cache: "reload" });
        if (resp && (resp.ok || resp.type === "opaque")) await c.put(url, resp);
      } catch (_) { /* keep going — a missing extra must not break install */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Let the page ask the worker to apply a waiting update on demand.
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // don't touch cross-origin

  // Page loads: cache-first on the app shell. This is what makes a cold start
  // work with no connection — including deep links, which the hash router
  // resolves client-side anyway.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cached = await caches.match(INDEX, { ignoreSearch: true });
      if (cached) return cached;
      try { return await fetch(req); }
      catch (_) {
        const any = await caches.match("./", { ignoreSearch: true });
        return any || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  // Everything else: serve from cache, refresh it in the background.
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const resp = await fetch(req);
      if (resp && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return resp;
    } catch (_) {
      return new Response("", { status: 504 });
    }
  })());
});
`;
      writeFileSync(resolve(dist, "sw.js"), sw.trim());
      console.log(`sw.js written with ${assets.length} precached assets`);
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
  },
  plugins: [swPlugin()],
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 3000,
  },
});
