import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("static output uses the Pages basename and resolves manifest icons", async () => {
  const client = new URL("../build-static/client/", import.meta.url);
  const html = await readFile(new URL("index.html", client), "utf8");
  assert.match(html, /"basename":"\/Image-Playground"/);
  assert.doesNotMatch(html, /["']\/(?:assets|workspace)\//);
  assert.doesNotMatch(html, /\.\/(?:module|url)\/assets/);

  const manifest = JSON.parse(await readFile(new URL("workspace/image-studio.webmanifest", client), "utf8"));
  const manifestUrl = "https://example.test/Image-Playground/workspace/image-studio.webmanifest";
  assert.equal(new URL(manifest.start_url, manifestUrl).pathname, "/Image-Playground/");
  assert.equal(new URL(manifest.scope, manifestUrl).pathname, "/Image-Playground/");
  for (const icon of manifest.icons) {
    assert.match(new URL(icon.src, manifestUrl).pathname, /^\/Image-Playground\/workspace\/app-/);
  }
});

for (const base of ["/", "/Image-Playground/"]) {
  test(`service worker caches and serves assets under ${base}`, async () => {
    const worker = await readFile(new URL("./pwa-worker.js", import.meta.url), "utf8");
    const listeners = {};
    let cachedRequests;
    const cache = {
      addAll: async (requests) => { cachedRequests = Array.from(requests, (request) => request.url); },
      match: async () => new Response("cached"),
    };
    const origin = "https://example.test";
    vm.runInNewContext(worker, {
      version: "test",
      assets: [base === "/" ? "/assets/example.js" : "./assets/example.js"],
      self: {
        location: new URL(`${origin}${base}sw.js`),
        addEventListener: (name, callback) => { listeners[name] = callback; },
      },
      caches: { open: async () => cache },
      URL, Request, Response, Headers, Set,
    });
    let pending;
    listeners.install({ waitUntil: (promise) => { pending = promise; } });
    await pending;
    assert.deepEqual(cachedRequests, [`${origin}${base}`, `${origin}${base}assets/example.js`]);
    let response;
    listeners.fetch({
      request: new Request(`${origin}${base}assets/example.js`),
      respondWith: (promise) => { response = promise; },
    });
    assert.equal(await (await response).text(), "cached");
  });
}
