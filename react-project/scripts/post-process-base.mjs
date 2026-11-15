import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const htmlPath = new URL("../build-static/client/index.html", import.meta.url);
const assetsDir = new URL("../build-static/client/assets/", import.meta.url);
const manifests = readdirSync(assetsDir)
  .filter((name) => /^manifest-.*\.js$/.test(name))
  .map((name) => new URL(name, assetsDir));

for (const path of [htmlPath, ...manifests]) {
  const content = readFileSync(path, "utf8");
  const out = content.replace(/(["'])\/(assets|workspace)\//g, "$1./$2/");
  writeFileSync(path, out, "utf8");
}
console.log("post-process base: rewrote static asset paths");
