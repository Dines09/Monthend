import { defineConfig, type Plugin } from "vite";
import { readdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
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
      // The cache name must be derived from the build's *content*, not the
      // clock. With `Date.now()` every rebuild — even one that changed nothing —
      // produced a new cache name, so `activate` threw away a cache that was
      // working perfectly and the app had to re-download itself. Hashing the
      // asset list (names already carry Vite's content hashes) means an
      // identical build reuses the identical cache and never re-fetches.
      const CACHE = "monthend-v" + pkg.version + "-" +
        createHash("sha256").update(assets.slice().sort().join("|")).digest("hex").slice(0, 12);
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

// Assets without which the app simply cannot start offline. If any of these
// is missing the precache is not usable, so we must not let it replace a cache
// that already works.
const CRITICAL = ASSETS.filter((u) => [".html", ".css", ".js"].some((x) => u.toLowerCase().endsWith(x)));

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Per-asset so one bad response can't abort the whole precache.
    const failed = [];
    await Promise.all(ASSETS.map(async (url) => {
      try {
        const resp = await fetch(url, { cache: "reload" });
        if (resp && (resp.ok || resp.type === "opaque")) await c.put(url, resp);
        else failed.push(url);
      } catch (_) { failed.push(url); }
    }));
    // The app shell also has to answer the start_url the manifest launches
    // ("./"), which is not itself in the asset list — without this entry a
    // cold launch from the home-screen icon has nothing to match and falls
    // through to the network.
    const idx = await c.match(INDEX);
    if (idx) await c.put("./", idx.clone());
    // A half-built cache is worse than no new cache: activate would delete the
    // old working one and leave the user with a broken app at sea. Bail out
    // instead and keep serving from whatever is already installed; the next
    // launch with a connection will retry the install cleanly.
    const brokeCritical = failed.some((u) => CRITICAL.includes(u)) || !idx;
    if (brokeCritical) {
      await caches.delete(CACHE);
      throw new Error("precache incomplete — keeping the previous cache");
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Only drop our own older caches, and only once this one is known good.
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE && k.startsWith("monthend-")).map((k) => caches.delete(k))
    );
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
      const cached = (await caches.match(INDEX, { ignoreSearch: true }))
        || (await caches.match("./", { ignoreSearch: true }));
      if (cached) return cached;
      try { return await fetch(req); }
      catch (_) {
        return new Response(
          "<!doctype html><meta charset=utf-8><title>Month End</title>" +
          "<body style='font:16px system-ui;padding:2rem;text-align:center'>" +
          "<h1>Month End</h1><p>The app is still installing. Open it once with a " +
          "connection and it will work offline from then on.</p>",
          { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
    })());
    return;
  }

  // Everything else: serve from cache, and only reach for the network when the
  // cache has nothing. A hit is returned as-is — no background revalidation,
  // because a stale-while-revalidate refresh is a network request the app does
  // not need and cannot rely on at sea.
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // Path-only retry: the Excel templates are requested with the app's base
    // URL, which differs between the dev server, Netlify and the installed
    // PWA. Matching on the pathname alone finds them whichever way the page
    // was launched.
    const byPath = await caches.match(url.pathname, { ignoreSearch: true });
    if (byPath) return byPath;
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
