import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pluginManifest } from "../app/lib/plugin-manifest.server.ts";

process.env.IMAGE_STUDIO_STATIC_BUILD = "true";
const cli = fileURLToPath(new URL("../node_modules/@react-router/dev/bin.cjs", import.meta.url));
const build = spawnSync(process.execPath, [cli, "build"], { stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

await writeFile(new URL("../build-static/client/workspace/plugin-manifest.json", import.meta.url), JSON.stringify(pluginManifest));
await import("./build-pwa.mjs");
