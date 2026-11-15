import { pluginManifest } from "../lib/plugin-manifest.server";

export function loader() {
  return Response.json(pluginManifest);
}
