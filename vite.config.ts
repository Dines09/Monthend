import { defineConfig, type Plugin } from "vite";
import { readdirSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

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
      assets.push("./");
      const CACHE = "monthend-" + Date.now();
      const sw = `
const CACHE = ${JSON.stringify(CACHE)};
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request).then((resp) => {
      const copy = resp.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return resp;
    }).catch(() => caches.match("./")))
  );
});
`;
      writeFileSync(resolve(dist, "sw.js"), sw.trim());
      console.log(`sw.js written with ${assets.length} precached assets`);
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [swPlugin()],
  build: {
    target: "es2020",
    chunkSizeWarningLimit: 3000,
  },
});
