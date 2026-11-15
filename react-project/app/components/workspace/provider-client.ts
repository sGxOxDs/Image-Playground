import { blobDataUrl, maxPromptLength, resolveImageSource, type Draft, type RequestPreview } from "./model";
import type { ImageProgress, ProviderPreview, ProviderProfile, ProviderResult } from "./provider-types";
import { partialImageCount, supportsSeed } from "./image-capabilities";
import { nativeEnhanceSetting, persistedKey, profileKey, protectedField, providerEndpoint } from "./provider-profiles";
import { streamLines } from "./stream-lines";

type UpstreamImage = { type?: string; b64_json?: string; result?: string; url?: string; revised_prompt?: string; seed?: number };
type UpstreamResult = { id?: string; status?: string; data?: UpstreamImage[]; output?: UpstreamImage[];
  created?: number; created_at?: number; seed?: number };
type Prepared = { preview: ProviderPreview; body: BodyInit; previous?: string };
const pending = new Map<string, () => Promise<UpstreamResult>>();

export class ProviderApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
export class ProviderJobCancelled extends Error {}

function safeText(value: string, key: string) {
  return (key ? value.split(key).join("••••") : value).replace(/\bBearer\s+[^\s,;]+/gi, "Bearer ••••");
}

function redact(value: unknown, key: string, depth = 0): unknown {
  if (depth >= 7) return "[已省略巢狀內容]";
  if (typeof value === "string") return /^(?:https?:\/\/|data:)/i.test(value) ? "[已隱藏網址或圖片]" : safeText(value, key).slice(0, 1500);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, key, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([name, child]) => [
    name, /^(?:b64_json|result|url|image_url|base64)$/i.test(name) ? "[已省略圖片資料]"
      : /key|credential|authorization|token$|cookie|password|secret/i.test(name) ? "••••"
      : redact(child, key, depth + 1),
  ]));
}

export async function providerApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "omit", redirect: "error", ...init });
  const data = await response.json().catch(() => undefined);
  if (!response.ok) throw new ProviderApiError(typeof data?.error === "string" ? data.error : "無法驗證 LiteLLM 身分。", response.status);
  return data as T;
}

async function upstream(url: string, key: string, signal: AbortSignal, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (key) headers.set("Authorization", "Bearer " + key);
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, signal, mode: "cors", credentials: "omit", redirect: "error" });
  } catch (error) {
    signal.throwIfAborted();
    throw new Error("無法連線至 Provider，請確認網址、連線與 CORS 是否允許此工作台的來源。", { cause: error });
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    const detail = error?.error;
    const message = typeof detail?.message === "string" ? " · " + safeText(detail.message, key).slice(0, 400) : "";
    const code = detail?.code ?? (detail?.param === "previous_response_id" ? "previous_response_not_found" : undefined);
    throw new ProviderApiError("Provider 回傳 HTTP " + response.status + message, response.status, code);
  }
  return response;
}

export async function discoverModels(baseUrl: string, key: string, signal: AbortSignal) {
  const response = await upstream(providerEndpoint(baseUrl, "", "/models"), key, signal);
  const data = await response.json();
  if (!Array.isArray(data?.data)) throw new Error("Provider 沒有回傳模型清單。");
  const ids = data.data.flatMap((model: { id?: unknown } | null) => typeof model?.id === "string" ? [model.id] : []);
  return [...new Set<string>(ids)].sort();
}

function requireKey(profile: ProviderProfile, namespace: string) {
  const key = profileKey(namespace, profile);
  if (!key && (namespace !== "standalone" || profile.hasKey || persistedKey(namespace, profile.id))) {
    throw new Error("請在 Provider 設定重新輸入 API Key。");
  }
  return key;
}

function jsonBody(value: unknown) {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}

async function fileFor(picture: Draft["references"][number], signal: AbortSignal) {
  const source = typeof picture.source === "string" ? resolveImageSource(picture.source) : picture.source;
  const blob = typeof source === "string" ? await (await fetch(source, { signal, credentials: "omit" })).blob() : source;
  return new File([blob], picture.title, { type: blob.type });
}

function requestHeaders(encoding: ProviderPreview["encoding"], hasKey: boolean) {
  return { "content-type": encoding === "multipart" ? "multipart/form-data" : "application/json",
    ...(hasKey ? { authorization: "Bearer ••••" } : {}) };
}

function prepareImages(draft: Draft, snapshot: RequestPreview, profile: ProviderProfile, files: File[], mask: File | undefined,
  hasKey: boolean, previewOnly: boolean, key: string): Prepared {
  const edit = draft.mode === "edit";
  const url = providerEndpoint(profile.baseUrl, edit ? profile.editPath : profile.generatePath, edit ? "/images/edits" : "/images/generations");
  const { field: native, value } = nativeEnhanceSetting(profile);
  const extras = { ...snapshot.extraBody };
  if (profile.sendSize && snapshot.extraOverrides?.includes("size")) delete extras.size;
  const partial = partialImageCount(profile, extras);
  const reserved = (name: string) => protectedField.test(name) || name === native || (partial > 0 && name === "partial_images");
  const conflicts = Object.keys(extras).filter(reserved);
  const fields: Record<string, unknown> = {
    ...Object.fromEntries(Object.entries(extras).filter(([name]) => !reserved(name))),
    model: profile.model, prompt: snapshot.prompt,
    ...(profile.sendSize ? { size: snapshot.width + "x" + snapshot.height } : {}),
    ...(supportsSeed(profile) && (!previewOnly || draft.seedMode !== "random") ? { [profile.seedField]: snapshot.seed } : {}),
    ...(snapshot.enhance === "provider" ? { [native]: value } : {}),
    ...(partial ? { stream: true, partial_images: partial } : {}),
  };
  if ("n" in fields && (typeof fields.n !== "number" || !Number.isInteger(fields.n) || fields.n < 1 || fields.n > 4)) {
    throw new Error("每次可請求 1 至 4 張圖片。");
  }
  const encoding = edit ? "multipart" : "json";
  const display = redactRequest(fields, key);
  const preview: ProviderPreview = { url, conflicts, encoding, headers: requestHeaders(encoding, hasKey), fields: display };
  if (!edit) return { preview, body: previewOnly ? "" : JSON.stringify(fields) };
  const encode = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value);
  const parts = Object.entries(fields).filter(([, value]) => value !== null);
  const imageField = profile.multiImage ? "image[]" : "image";
  preview.fields = { ...Object.fromEntries(parts.map(([name]) => [name, encode(display[name])])),
    [imageField]: files.map(fileDetails), ...(mask ? { mask: fileDetails(mask) } : {}) };
  if (previewOnly) return { preview, body: "" };
  const form = new FormData();
  for (const [name, value] of parts) form.append(name, encode(value));
  for (const file of files) form.append(imageField, file);
  if (mask) form.append("mask", mask);
  return { preview, body: form };
}

function fileDetails(file: File) {
  return { name: file.name, size: file.size, type: file.type };
}

function redactRequest(fields: Record<string, unknown>, key: string): Record<string, unknown> {
  const clean = (value: unknown): unknown => {
    if (typeof value === "string") return safeText(value, key);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return redactRequest(value as Record<string, unknown>, key);
    return value;
  };
  return Object.fromEntries(Object.entries(fields).map(([name, value]) => [
    name, /key|credential|authorization|token|password|secret/i.test(name) ? "••••" : clean(value),
  ]));
}

const imageToolFields = new Set(["background", "quality", "output_format", "output_compression", "input_fidelity", "moderation", "complexity"]);

async function continuationProof(profile: ProviderProfile, id: string, image: Blob) {
  const context = JSON.stringify([profile.id, profile.baseUrl, profile.model, profile.responsesModel, id]);
  const bytes = new Uint8Array(await new Blob([context, image]).arrayBuffer());
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return "browser:" + Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function prepareResponses(draft: Draft, snapshot: RequestPreview, profile: ProviderProfile, files: File[],
  mask: File | undefined, hasKey: boolean, previewOnly: boolean, key: string, restore = true): Promise<Prepared> {
  if (snapshot.enhance === "provider") throw new Error("Responses API 請使用自動增強或原始提示詞。");
  const source = draft.references[0]?.continuation;
  const previous = restore && draft.mode === "edit" && !mask && draft.useResponseContext !== false && files[0] &&
    source && validResponseId(source.id) && typeof source.proof === "string" && source.proof.startsWith("browser:") &&
    source.proof === await continuationProof(profile, source.id, files[0]) ? source.id : undefined;
  const attached = previous ? files.slice(1) : files;
  const extras = Object.entries(snapshot.extraBody);
  const tool = { ...Object.fromEntries(extras.filter(([name]) => imageToolFields.has(name))), type: "image_generation",
    model: profile.model, action: draft.mode, ...(profile.sendSize ? { size: snapshot.width + "x" + snapshot.height } : {}) };
  const envelope = { model: profile.responsesModel, store: true, tool_choice: { type: "image_generation" },
    ...(profile.imageCapabilities?.responsesBackground ? { background: true } : {}),
    ...(previous ? { previous_response_id: previous } : {}) };
  const fields = (pictures: string[], maskUrl?: string) => ({ ...envelope,
    tools: [{ ...tool, ...(maskUrl ? { input_image_mask: { image_url: maskUrl } } : {}) }],
    input: [{ role: "user", content: [{ type: "input_text", text: snapshot.prompt },
      ...pictures.map((image_url) => ({ type: "input_image", image_url, detail: "auto" }))] }],
  });
  const display = fields(attached.map((file) => "[附件 " + file.name + " · " + file.size + " bytes]"), mask && "[遮罩 " + mask.name + "]");
  return { previous,
    body: previewOnly ? "" : JSON.stringify(fields(await Promise.all(attached.map(blobDataUrl)), mask ? await blobDataUrl(mask) : undefined)),
    preview: { url: providerEndpoint(profile.baseUrl, "", "/responses"), encoding: "json", headers: requestHeaders("json", hasKey),
      fields: redactRequest(display, key), conflicts: extras.filter(([name]) => !imageToolFields.has(name)).map(([name]) => name) },
  };
}

function validResponseId(id: unknown): id is string {
  return typeof id === "string" && /^[\w-]{1,256}$/.test(id);
}

async function pollResponse(initial: UpstreamResult, url: string, key: string, signal: AbortSignal, progress?: (event: ImageProgress) => void) {
  if (!validResponseId(initial.id)) throw new Error("Provider 未回傳有效的背景工作 ID。");
  const id = initial.id;
  const taskUrl = url + "/" + id;
  const ticket = crypto.randomUUID();
  let inFlight: Promise<UpstreamResult> | undefined;
  let cancelled = false;
  const cancel = () => inFlight ??= upstream(taskUrl + "/cancel", key, AbortSignal.timeout(12_000), { method: "POST" })
    .then(async (response): Promise<UpstreamResult> => {
      const data: UpstreamResult = await response.json();
      if (data.id !== id) throw new Error("Provider 回傳不同的背景工作 ID。");
      cancelled = data.status === "cancelled";
      return data;
    }).finally(() => { inFlight = undefined; });
  pending.set(ticket, cancel);
  let payload = initial;
  let previous: string | undefined;
  const end = AbortSignal.any([signal, AbortSignal.timeout(5 * 60_000)]);
  try {
    while (payload.status === "queued" || payload.status === "in_progress") {
      if (cancelled) throw new ProviderJobCancelled();
      if (previous !== payload.status) progress?.({ type: "background", status: payload.status, ticket });
      previous = payload.status;
      await pollDelay(end);
      if (cancelled) throw new ProviderJobCancelled();
      payload = await (await upstream(taskUrl, key, end)).json();
      if (payload.id !== id) throw new Error("Provider 回傳不同的背景工作 ID。");
    }
    if (cancelled || payload.status === "cancelled") throw new ProviderJobCancelled();
    if (payload.status !== "completed") throw new Error("Provider 背景工作未完成。");
    return payload;
  } finally {
    pending.delete(ticket);
    if (end.aborted && !cancelled && (payload.status === "queued" || payload.status === "in_progress")) void cancel().catch(() => {});
  }
}

function pollDelay(signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    function abort() { clearTimeout(timer); reject(signal.reason); }
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1000);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function readEvents(response: Response, mode: Draft["mode"], progress?: (event: ImageProgress) => void): Promise<UpstreamResult> {
  if (!response.body) throw new Error("Provider 串流回應為空。");
  const prefix = mode === "edit" ? "image_edit." : "image_generation.";
  const seen = new Set<number>();
  let name = "";
  let lines: string[] = [];
  for await (const line of streamLines(response.body, 140 * 1024 * 1024)) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
    if (line || !lines.length) continue;
    const data = lines.join("\n");
    lines = [];
    if (data === "[DONE]") break;
    const event = JSON.parse(data);
    const type = event.type ?? name;
    name = "";
    if (type === "error") throw new Error("Provider 回報圖片串流失敗。");
    if (type === prefix + "completed" && typeof event.b64_json === "string") return { ...event, data: [event] };
    if (type === prefix + "partial_image" && typeof event.b64_json === "string" && [0, 1, 2].includes(event.partial_image_index)) {
      if (!seen.has(event.partial_image_index)) {
        seen.add(event.partial_image_index);
        progress?.({ type: "partial", count: seen.size });
      }
    }
  }
  throw new Error("生成串流在完整圖片送達前結束。");
}

const maxImageBytes = 24 * 1024 * 1024;
function imageMime(bytes: Uint8Array) {
  const signature = [...bytes.slice(0, 12)];
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => signature[index] === byte)) return "image/png";
  if ([255, 216, 255].every((byte, index) => signature[index] === byte)) return "image/jpeg";
  if (String.fromCharCode(...signature.slice(0, 4)) === "RIFF" && String.fromCharCode(...signature.slice(8, 12)) === "WEBP") return "image/webp";
  throw new Error("Provider 回傳的圖片格式不受支援。");
}

async function decodeImage(item: UpstreamImage, url: string, key: string, signal: AbortSignal) {
  const data = item.b64_json ?? item.result;
  let bytes: Uint8Array<ArrayBuffer>;
  if (typeof data === "string" && data.length) {
    if (data.length > Math.ceil(maxImageBytes / 3) * 4) throw new Error("圖片輸出超過大小上限。");
    bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
  } else if (typeof item.url === "string") {
    const source = new URL(item.url, url);
    if (source.username || source.password || (source.protocol !== "https:" && source.origin !== new URL(url).origin)) {
      throw new Error("Provider 回傳無效的圖片來源。");
    }
    const response = await upstream(source.href, "", signal);
    bytes = new Uint8Array(await response.arrayBuffer());
  } else throw new Error("Provider 回應缺少圖片資料。");
  if (bytes.length > maxImageBytes) throw new Error("圖片輸出超過大小上限。");
  const mime = imageMime(bytes);
  return { blob: new Blob([bytes], { type: mime }), seed: seed(item.seed),
    revisedPrompt: typeof item.revised_prompt === "string" ? safeText(item.revised_prompt, key).slice(0, maxPromptLength) : undefined };
}

function seed(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export async function sendImage(draft: Draft, snapshot: RequestPreview, profile: ProviderProfile, signal: AbortSignal,
  previewOnly: true, namespace: string): Promise<ProviderPreview>;
export async function sendImage(draft: Draft, snapshot: RequestPreview, profile: ProviderProfile, signal: AbortSignal,
  previewOnly: false, namespace: string, progress?: (event: ImageProgress) => void): Promise<ProviderResult>;
export async function sendImage(draft: Draft, snapshot: RequestPreview, profile: ProviderProfile, signal: AbortSignal,
  previewOnly: boolean, namespace: string, progress?: (event: ImageProgress) => void): Promise<ProviderPreview | ProviderResult> {
  const key = previewOnly ? profileKey(namespace, profile) : requireKey(profile, namespace);
  const hasKey = Boolean(key || profile.hasKey || persistedKey(namespace, profile.id));
  const files = draft.mode === "edit" || profile.responsesModel
    ? await Promise.all(draft.references.map((picture) => fileFor(picture, signal))) : [];
  const mask = draft.mode === "edit" && draft.mask ? await fileFor(draft.mask, signal) : undefined;
  let prepared = profile.responsesModel
    ? await prepareResponses(draft, snapshot, profile, files, mask, hasKey, previewOnly, key)
    : prepareImages(draft, snapshot, profile, files, mask, hasKey, previewOnly, key);
  if (previewOnly) return prepared.preview;
  const dispatch = (request: Prepared) => upstream(request.preview.url, key, AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    { method: "POST", body: request.body, headers: request.preview.encoding === "json" ? { "content-type": "application/json" } : undefined });
  let response: Response;
  try { response = await dispatch(prepared); }
  catch (error) {
    if (!prepared.previous || !(error instanceof ProviderApiError) || error.code !== "previous_response_not_found") throw error;
    prepared = await prepareResponses(draft, snapshot, profile, files, mask, hasKey, false, key, false);
    response = await dispatch(prepared);
  }
  let payload: UpstreamResult = response.headers.get("content-type")?.includes("text/event-stream")
    ? await readEvents(response, draft.mode, progress) : await response.json();
  if (profile.responsesModel && (payload.status === "queued" || payload.status === "in_progress")) {
    payload = await pollResponse(payload, prepared.preview.url, key, signal, progress);
  }
  const outputs = profile.responsesModel ? payload.output?.filter((item) => item?.type === "image_generation_call") : payload.data;
  if (!Array.isArray(outputs) || outputs.length < 1 || outputs.length > 4) throw new Error("Provider 未回傳可用的圖片結果。");
  const images = await Promise.all(outputs.map((item) => decodeImage(item, prepared.preview.url, key, signal)));
  const id = profile.responsesModel && validResponseId(payload.id) ? payload.id : undefined;
  const continuation = id && images.length === 1
    ? { id, proof: await continuationProof(profile, id, images[0].blob) } : undefined;
  return { images, preview: prepared.preview, continuation,
    response: { count: images.length, created: payload.created_at ?? payload.created, seed: seed(payload.seed), id, body: redact(payload, key) } };
}

export async function cancelProviderJob(ticket: string) {
  const cancel = pending.get(ticket);
  if (cancel && (await cancel()).status !== "cancelled") throw new Error("Provider 尚未確認取消。");
}

export async function requestEnhancedPrompt(profile: ProviderProfile, prompt: string, signal: AbortSignal, namespace: string) {
  const key = requireKey(profile, namespace);
  const response = await upstream(providerEndpoint(profile.baseUrl, "", "/chat/completions"), key, signal, jsonBody({
    model: profile.enhanceModel,
    messages: [
      { role: "system", content: "Enhance the user's image prompt in its original language. Preserve intent, required details and constraints. Return only the revised prompt." },
      { role: "user", content: prompt },
    ],
  }));
  const data = await response.json();
  const candidate = data?.choices?.[0]?.message?.content;
  if (typeof candidate !== "string" || !candidate.trim() || candidate.trim().length > maxPromptLength) {
    throw new Error("文字模型沒有回傳可用的提示詞。");
  }
  return { prompt: safeText(candidate.trim(), key) };
}
