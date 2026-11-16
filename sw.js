const version = "5d993ebfa2ef3d1713ee";
const assets = ["./assets/api.gateway-BvRk9kiK.js","./assets/api.plugin-auth-BvRk9kiK.js","./assets/api.plugin-manifest-BvRk9kiK.js","./assets/api.session-BvRk9kiK.js","./assets/appearance-x48SIvFG.js","./assets/chrome-devtools-BvRk9kiK.js","./assets/entry.client-Dgn1TTJN.js","./assets/home-B-Nz0lS3.js","./assets/home-buGPy1HJ.css","./assets/jsx-runtime-Yykwgpsd.js","./assets/manifest-c7752a1e.js","./assets/root-CzGPlItO.css","./assets/root-y_U9pIcz.js","./workspace/app-192.png","./workspace/app-512.png","./workspace/image-studio.webmanifest","./workspace/material-symbols.woff2","./workspace/neon-street.webp","./workspace/plugin-handshake.js","./workspace/plugin-manifest.json","./workspace/shinjuku.webp"];
/* version and assets are defined by build-pwa.mjs. */
const prefix = "image-studio-pwa-";
const cacheName = prefix + version;
const basePath = new URL(".", self.location.href).pathname;
const standaloneUrl = basePath;
const paths = new Set(assets.map((path) => new URL(path, self.location.href).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const urls = [standaloneUrl, ...assets].map((path) => new URL(path, self.location.href));
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
  if (url.pathname === basePath && request.mode === "navigate" && request.destination === "document") {
    event.respondWith(standaloneDocument(request));
    return;
  }
  if (!url.search && paths.has(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(async (cache) =>
      await cache.match(request) ?? fetch(request)));
  }
});
