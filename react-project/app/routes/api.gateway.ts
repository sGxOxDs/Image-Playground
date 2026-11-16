import { getPluginSession, PluginError, pluginFailure } from "../lib/plugin.server";

const responseOwners = new Map<string, { namespace: string; expiresAt: number }>();
const maxBodyBytes = 128 * 1024 * 1024;
const forbiddenFields = /^(?:api_?key|api_?base|base_?url|api_?version|authorization|headers|extra_headers|extra_body|metadata|litellm_metadata|litellm_params|proxy_server_request|custom_llm_provider|aws_access_key_id|aws_secret_access_key|aws_session_token)$/i;
const allowed = new Map([
  ["/v1/models", "GET"],
  ["/v1/images/generations", "POST"],
  ["/v1/images/edits", "POST"],
  ["/v1/chat/completions", "POST"],
  ["/v1/responses", "POST"],
]);

function validateFields(value: unknown, depth = 0): void {
  if (!value || typeof value !== "object") return;
  if (depth > 32) throw new PluginError("Gateway 請求巢狀層數過多。", 400);
  for (const [name, child] of Object.entries(value)) {
    if (forbiddenFields.test(name)) throw new PluginError("Gateway 請求包含受限制的欄位。", 400);
    validateFields(child, depth + 1);
  }
}

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new PluginError("Gateway 請求內容為空。", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBodyBytes) {
      await reader.cancel();
      throw new PluginError("Gateway 請求過大。", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function handle(request: Request, path: string) {
  try {
    const identity = getPluginSession(request);
    if (!identity) throw new PluginError("請先登入 LiteLLM。");
    const key = process.env.LITELLM_SHARED_API_KEY;
    const base = process.env.LITELLM_API_BASE;
    if (!key || !base) throw new PluginError("共用 Gateway 尚未設定。", 503);
    const endpoint = "/" + path;
    const responseMatch = /^\/v1\/responses\/([A-Za-z0-9_-]{1,256})(\/cancel)?$/.exec(endpoint);
    const permitted = allowed.get(endpoint) === request.method
      || Boolean(responseMatch && request.method === (responseMatch[2] ? "POST" : "GET"));
    if (!permitted || new URL(request.url).search) throw new PluginError("不支援此 Gateway 端點。", 404);
    const gateway = new URL(base);
    if (!["http:", "https:"].includes(gateway.protocol) || gateway.username || gateway.password || gateway.search || gateway.hash) {
      throw new PluginError("Gateway 位址設定無效。", 503);
    }
    const now = Date.now();
    for (const [id, owner] of responseOwners) if (owner.expiresAt <= now) responseOwners.delete(id);
    if (endpoint === "/v1/responses" && responseOwners.size >= 10_000) {
      throw new PluginError("背景工作數量已達上限。", 503);
    }
    if (responseMatch && responseOwners.get(responseMatch[1])?.namespace !== identity.namespace) {
      throw new PluginError("無法存取此背景工作。", 403);
    }
    const headers = new Headers({ Authorization: `Bearer ${key}` });
    let body: BodyInit | undefined;
    if (request.method === "POST" && !responseMatch) {
      const length = Number(request.headers.get("content-length"));
      if (length > maxBodyBytes) throw new PluginError("Gateway 請求過大。", 413);
      const contentType = request.headers.get("content-type") ?? "";
      if (contentType.startsWith("application/json")) {
        const bytes = await readBody(request);
        let payload: unknown;
        try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
        catch { throw new PluginError("Gateway 請求格式無效。", 400); }
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new PluginError("Gateway 請求格式無效。", 400);
        validateFields(payload);
        const fields = payload as Record<string, unknown>;
        if (endpoint === "/v1/responses" && fields.previous_response_id !== undefined
            && (typeof fields.previous_response_id !== "string"
              || responseOwners.get(fields.previous_response_id)?.namespace !== identity.namespace)) {
          throw new PluginError("無法存取先前的回應。", 403);
        }
        fields.user = identity.userId;
        headers.set("Content-Type", "application/json");
        body = JSON.stringify(fields);
      } else if (endpoint === "/v1/images/edits" && contentType.startsWith("multipart/form-data;")) {
        const bytes = await readBody(request);
        const form = await new Request(request.url, { method: "POST", headers: { "content-type": contentType }, body: bytes }).formData();
        for (const name of form.keys()) if (forbiddenFields.test(name)) throw new PluginError("Gateway 請求包含受限制的欄位。", 400);
        form.delete("user");
        form.append("user", identity.userId);
        body = form;
      } else throw new PluginError("Gateway 請求格式不受支援。", 415);
    }
    const url = gateway.origin + gateway.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") + endpoint;
    const upstream = await fetch(url, { method: request.method, headers, body, redirect: "error", signal: request.signal });
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok) {
      const text = (await upstream.text()).split(key).join("••••");
      return new Response(text, { status: upstream.status, headers: { "content-type": contentType, "cache-control": "no-store" } });
    }
    if (endpoint === "/v1/responses" && contentType.includes("application/json")) {
      const text = await upstream.text();
      const data: unknown = JSON.parse(text);
      if (data && typeof data === "object" && "id" in data && typeof data.id === "string"
          && /^[A-Za-z0-9_-]{1,256}$/.test(data.id)) {
        responseOwners.set(data.id, { namespace: identity.namespace, expiresAt: now + 24 * 60 * 60_000 });
      }
      return new Response(text, { status: upstream.status, headers: { "content-type": contentType, "cache-control": "no-store" } });
    }
    return new Response(upstream.body, { status: upstream.status, headers: { "content-type": contentType, "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PluginError) return pluginFailure(error);
    console.error("Gateway proxy request failed");
    return pluginFailure(new PluginError("無法連線至共用 Gateway。", 502));
  }
}

export function loader({ request, params }: { request: Request; params: { "*": string | undefined } }) {
  return handle(request, params["*"] ?? "");
}

export function action({ request, params }: { request: Request; params: { "*": string | undefined } }) {
  return handle(request, params["*"] ?? "");
}
