import { assertPluginOrigin, exchangeClaim, pluginFailure, PluginError } from "../lib/plugin.server";

export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  let origin: string | null = null;
  try {
    assertPluginOrigin(request);
    origin = request.headers.get("origin");
    if (Number(request.headers.get("content-length")) > 16_384) {
      throw new PluginError("LiteLLM 登入請求過大。", 413);
    }
    const body = await request.json().catch(() => null);
    if (typeof body?.session_claim !== "string" || typeof body.parent_origin !== "string") {
      throw new PluginError("缺少 LiteLLM 身分聲明。", 400);
    }
    const previous = typeof body.previous_token === "string" && /^[A-Za-z0-9_-]{43}$/.test(body.previous_token)
      ? body.previous_token : /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("authorization") ?? "")?.[1];
    return withOrigin(Response.json(exchangeClaim(body.session_claim, body.parent_origin, previous),
      { headers: { "Cache-Control": "no-store" } }), origin);
  } catch (error) { return withOrigin(pluginFailure(error), origin); }
}

function withOrigin(response: Response, origin: string | null) {
  response.headers.append("Vary", "Origin");
  if (origin) response.headers.set("Access-Control-Allow-Origin", origin);
  return response;
}
