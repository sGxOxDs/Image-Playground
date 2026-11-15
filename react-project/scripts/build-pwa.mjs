import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";

const staticBuild = process.env.IMAGE_STUDIO_STATIC_BUILD === "true";
const build = new URL(staticBuild ? "../build-static/" : "../build/", import.meta.url);
const client = new URL("client/", build);
const editorAssets = [
  "/workspace/app-192.png", "/workspace/app-512.png", "/workspace/image-studio.webmanifest",
  "/workspace/material-symbols.woff2", "/workspace/neon-street.webp", "/workspace/shinjuku.webp",
  "/workspace/plugin-handshake.js",
];
const files = (await readdir(new URL("assets/", client), { withFileTypes: true }))
  .filter((file) => file.isFile() && !file.name.endsWith(".map"))
  .map((file) => "/assets/" + file.name);
const paths = [...editorAssets, ...files].sort();
const worker = await readFile(new URL("./pwa-worker.js", import.meta.url), "utf8");
const hash = createHash("sha256").update(worker)
  .update(await readFile(new URL(staticBuild ? "client/index.html" : "server/index.js", build)));
for (const path of paths) {
  hash.update(path).update(await readFile(new URL(path.slice(1), client)));
}
const version = hash.digest("hex").slice(0, 20);
const config = "const version = " + JSON.stringify(version) + ";\nconst assets = " + JSON.stringify(paths) + ";\n";
await writeFile(new URL("sw.js", client), config + worker);
console.log(`PWA precache ${version} contains ${paths.length} assets and the standalone page.`);
