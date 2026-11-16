import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";

const staticBuild = process.env.IMAGE_STUDIO_STATIC_BUILD === "true";
const base = staticBuild ? "./" : "/";
const build = new URL(staticBuild ? "../build-static/" : "../build/", import.meta.url);
const client = new URL("client/", build);
const editorAssets = [
  base + "workspace/app-192.png", base + "workspace/app-512.png", base + "workspace/image-studio.webmanifest",
  base + "workspace/material-symbols.woff2", base + "workspace/neon-street.webp", base + "workspace/shinjuku.webp",
  base + "workspace/plugin-handshake.js",
  ...(staticBuild ? [base + "workspace/plugin-manifest.json"] : []),
];
const files = (await readdir(new URL("assets/", client), { withFileTypes: true }))
  .filter((file) => file.isFile() && !file.name.endsWith(".map"))
  .map((file) => base + "assets/" + file.name);
const paths = [...editorAssets, ...files].sort();
const readPaths = paths.map((p) => p.replace(/^(?:\.\/|\/)/, ""));
const worker = await readFile(new URL("./pwa-worker.js", import.meta.url), "utf8");
const hash = createHash("sha256").update(worker)
  .update(await readFile(new URL(staticBuild ? "client/index.html" : "server/index.js", build)));
for (const path of readPaths) {
  hash.update(path).update(await readFile(new URL(path, client)));
}
const version = hash.digest("hex").slice(0, 20);
const config = "const version = " + JSON.stringify(version) + ";\nconst assets = " + JSON.stringify(paths) + ";\n";
await writeFile(new URL("sw.js", client), config + worker);
console.log(`PWA precache ${version} contains ${paths.length} assets and the standalone page.`);
