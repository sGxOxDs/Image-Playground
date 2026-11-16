import { getPluginSession, PluginError, pluginFailure } from "../lib/plugin.server";

const responseOwners = new Map<string, { namespace: string; expiresAt: number }>();
const MiB = 1024 * 1024;
const maxBodyBytes = 128 * MiB;
const maxErrorBytes = 64 * 1024;
const uploadBudget = positiveInt("LITELLM_PROXY_UPLOAD_BUDGET_MIB", 512) * MiB;
const uploadTimeout = positiveInt("LITELLM_PROXY_UPLOAD_TIMEOUT_MS", 60_000);
const upstreamTimeout = positiveInt("LITELLM_PROXY_UPSTREAM_TIMEOUT_MS", 300_000);
let reservedUploadBytes = 0;
const forbiddenFields = /^(?:api_?key|api_?base|base_?url|api_?version|authorization|headers|extra_headers|extra_body|metadata|litellm_metadata|litellm_params|proxy_server_request|custom_llm_provider|aws_access_key_id|aws_secret_access_key|aws_session_token)$/i;
const allowed = new Map([
  ["/v1/models", "GET"],
  ["/v1/images/generations", "POST"],
  ["/v1/images/edits", "POST"],
  ["/v1/chat/completions", "POST"],
  ["/v1/responses", "POST"],
]);

function positiveInt(name: string, fallback: number) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function validateFields(value: unknown, depth = 0): void {
  if (!value || typeof value !== "object") return;
  if (depth > 32) throw new PluginError("Gateway 請求巢狀層數過多。", 400);
  for (const name in value) {
    if (!Object.hasOwn(value, name)) continue;
    if (forbiddenFields.test(name)) throw new PluginError("Gateway 請求包含受限制的欄位。", 400);
    validateFields((value as Record<string, unknown>)[name], depth + 1);
  }
}

async function readBody(
  stream: ReadableStream<Uint8Array>, limit: number, signal: AbortSignal, expected?: number,
) {
  const reader = stream.getReader();
  // Cancelling the incoming stream also destroys the HTTP socket in the server adapter.
  const interrupt = () => reader.releaseLock();
  signal.addEventListener("abort", interrupt, { once: true });
  const buffer = expected === undefined ? undefined : new Uint8Array(expected);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      const next = length + value.byteLength;
      if (next > limit) throw new PluginError("Gateway 請求過大。", 413);
      if (buffer) {
        if (next > buffer.byteLength) throw new PluginError("Gateway 請求長度不符。", 400);
        buffer.set(value, length);
      } else {
        chunks.push(value);
      }
      length = next;
    }
    if (buffer) {
      if (length !== expected) throw new PluginError("Gateway 請求長度不符。", 400);
      return buffer;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", interrupt);
    reader.releaseLock();
  }
}

async function readUpload(request: Request, expected?: number) {
  if (!request.body) throw new PluginError("Gateway 請求內容為空。", 400);
  const timeout = AbortSignal.timeout(uploadTimeout);
  try {
    return await readBody(request.body, maxBodyBytes, AbortSignal.any([request.signal, timeout]), expected);
  } catch (error) {
    if (timeout.aborted) throw new PluginError("Gateway 請求上傳逾時。", 408);
    throw error;
  }
}

async function discardUpload(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return;
  const timeout = AbortSignal.timeout(uploadTimeout);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  timeout.addEventListener("abort", cancel, { once: true });
  try {
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBodyBytes) {
        cancel();
        break;
      }
    }
  } catch {
    // The client may stop sending after it receives the rejection.
  } finally {
    timeout.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

async function upstreamError(upstream: Response, key: string, signal: AbortSignal) {
  const headers = { "content-type": upstream.headers.get("content-type") ?? "", "cache-control": "no-store" };
  if (!upstream.body) return new Response(null, { status: upstream.status, headers });
  try {
    const bytes = await readBody(upstream.body, maxErrorBytes, AbortSignal.any([signal, AbortSignal.timeout(5_000)]));
    const text = new TextDecoder().decode(bytes).split(key).join("••••");
    return new Response(text, { status: upstream.status, headers });
  } catch {
    void upstream.body.cancel().catch(() => {});
    return Response.json({ error: "共用 Gateway 回傳錯誤。" }, {
      status: upstream.status, headers: { "cache-control": "no-store" },
    });
  }
}

async function handle(request: Request, path: string) {
  let reservation = 0;
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
      const contentType = request.headers.get("content-type") ?? "";
      const json = contentType.startsWith("application/json");
      const multipart = endpoint === "/v1/images/edits" && contentType.startsWith("multipart/form-data;");
      const declaredLength = request.headers.get("content-length");
      const length = declaredLength === null ? undefined : Number(declaredLength);
      if (length !== undefined && length > maxBodyBytes) throw new PluginError("Gateway 請求過大。", 413);
      if (length !== undefined && (!Number.isSafeInteger(length) || length < 0)) {
        throw new PluginError("Gateway 請求長度無效。", 400);
      }
      if (!json && !multipart) throw new PluginError("Gateway 請求格式不受支援。", 415);
      const weight = Math.max(64 * 1024, (length ?? maxBodyBytes) * 4);
      if (reservedUploadBytes + weight > uploadBudget) {
        // Drain transport bytes without buffering or parsing the rejected upload.
        void discardUpload(request);
        return Response.json({ error: "共用 Gateway 上傳容量暫滿。" }, {
          status: 503, headers: { "retry-after": "2", "cache-control": "no-store" },
        });
      }
      reservedUploadBytes += weight;
      reservation = weight;
      const bytes = await readUpload(request, length);
      if (json) {
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
      } else {
        // Use a stream to avoid copying the complete upload into a second Request.
        const stream = new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(bytes); controller.close(); },
        });
        let form: FormData;
        try { form = await new Response(stream, { headers: { "content-type": contentType } }).formData(); }
        catch { throw new PluginError("Gateway 請求格式無效。", 400); }
        for (const name of form.keys()) if (forbiddenFields.test(name)) throw new PluginError("Gateway 請求包含受限制的欄位。", 400);
        form.delete("user");
        form.append("user", identity.userId);
        body = form;
      }
    }
    const url = gateway.origin + gateway.pathname.replace(/\/+$/, "").replace(/\/v1$/, "") + endpoint;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), upstreamTimeout);
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: request.method, headers, body, redirect: "error",
        signal: AbortSignal.any([request.signal, controller.signal]),
      });
    } catch (error) {
      if (controller.signal.aborted) throw new PluginError("共用 Gateway 等待回應逾時。", 504);
      throw error;
    } finally {
      clearTimeout(timer);
      reservedUploadBytes -= reservation;
      reservation = 0;
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok) return await upstreamError(upstream, key, request.signal);
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
    if (error instanceof PluginError) {
      const response = pluginFailure(error);
      if (error.status === 408 || error.status === 413) response.headers.set("connection", "close");
      return response;
    }
    console.error("Gateway proxy request failed");
    return pluginFailure(new PluginError("無法連線至共用 Gateway。", 502));
  } finally {
    reservedUploadBytes -= reservation;
  }
}

export function loader({ request, params }: { request: Request; params: { "*": string | undefined } }) {
  return handle(request, params["*"] ?? "");
}

export function action({ request, params }: { request: Request; params: { "*": string | undefined } }) {
  return handle(request, params["*"] ?? "");
}
