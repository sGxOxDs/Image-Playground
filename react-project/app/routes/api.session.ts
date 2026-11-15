import { getPluginSession, pluginFailure } from "../lib/plugin.server";
import { parentOrigins } from "../lib/plugin-origins.server";

export function loader({ request }: { request: Request }) {
  try {
    return Response.json({ parentOrigins: parentOrigins(), identity: getPluginSession(request) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return pluginFailure(error); }
}
