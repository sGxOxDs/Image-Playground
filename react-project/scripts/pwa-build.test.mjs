import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("production PWA build hashes assets while retaining root-relative precache URLs", async () => {
  const env = { ...process.env };
  delete env.IMAGE_STUDIO_STATIC_BUILD;
  execFileSync(process.execPath, [fileURLToPath(new URL("./build-pwa.mjs", import.meta.url))], { env });
  const worker = await readFile(new URL("../build/client/sw.js", import.meta.url), "utf8");
  assert.match(worker, /"\/assets\/[^"]+\.js"/);
  assert.match(worker, /"\/workspace\/plugin-handshake\.js"/);
  assert.doesNotMatch(worker, /"\/workspace\/plugin-manifest\.json"/);
});
