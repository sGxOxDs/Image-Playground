const version = "50b6394513de5113e817";
const assets = ["./assets/api.plugin-auth-BvRk9kiK.js","./assets/api.plugin-manifest-BvRk9kiK.js","./assets/api.session-BvRk9kiK.js","./assets/appearance-x48SIvFG.js","./assets/chrome-devtools-BvRk9kiK.js","./assets/entry.client-Dgn1TTJN.js","./assets/home-CEJLyYBK.js","./assets/home-DRoFAuxt.css","./assets/jsx-runtime-Yykwgpsd.js","./assets/manifest-94927b58.js","./assets/root-B8gmSfPl.css","./assets/root-Crm52i4O.js","./workspace/app-192.png","./workspace/app-512.png","./workspace/image-studio.webmanifest","./workspace/material-symbols.woff2","./workspace/neon-street.webp","./workspace/plugin-handshake.js","./workspace/plugin-manifest.json","./workspace/shinjuku.webp"];
/* version and assets are defined by build-pwa.mjs. */
const prefix = "image-studio-pwa-";
const cacheName = prefix + version;
const paths = new Set(assets);

const swDir = self.location.pathname.substring(0, self.location.pathname.lastIndexOf("/") + 1);
const basePath = swDir;
const standaloneUrl = (basePath === "" ? "/" : basePath);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const urls = [standaloneUrl, ...assets].map((path) => new URL(path, self.location.origin));
    const requests = urls.map((u) => new Request(u, { credentials: "omit", cache: "reload" }));
    await cache.addAll(requests);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(prefix) && name !== cacheName)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function standaloneDocument(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(cacheName);
    const saved = await cache.match(standaloneUrl);
    if (!saved) return Response.error();
    const headers = new Headers(saved.headers);
    headers.append("Content-Security-Policy", "frame-ancestors 'none'");
    return new Response(saved.body, { status: saved.status, headers });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // 站點可能部署於子路徑（例如 GitHub Pages 的 /Image-Playground/），
  // 因此以 SW 自身的目錄作為 basePath 判斷導航與資產路徑，而非固定根目錄
  if (url.pathname === basePath && request.mode === "navigate" && request.destination === "document") {
    event.respondWith(standaloneDocument(request));
    return;
  }
  const relPath = basePath === "" ? url.pathname : url.pathname.replace(new RegExp("^" + basePath.replace(/[/]/g, "\\$&"), "");
  if (!url.search && paths.has(relPath)) {
    event.respondWith(caches.open(cacheName).then(async (cache) =>
      await cache.match(request) ?? fetch(request)));
  }
});
