/* version and assets are defined by build-pwa.mjs. */
const prefix = "image-studio-pwa-";
const cacheName = prefix + version;
const paths = new Set(assets);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(["/", ...assets].map((path) => new Request(new URL(path, self.location.origin), {
      credentials: "omit",
      cache: "reload",
    })));
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
    const saved = await cache.match("/");
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
  if (url.pathname === "/" && request.mode === "navigate" && request.destination === "document") {
    event.respondWith(standaloneDocument(request));
    return;
  }
  if (!url.search && paths.has(url.pathname)) {
    event.respondWith(caches.open(cacheName).then(async (cache) =>
      await cache.match(request) ?? fetch(request)));
  }
});
