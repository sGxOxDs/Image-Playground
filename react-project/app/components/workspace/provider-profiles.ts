import { parseImageCapabilities } from "./image-capabilities";
import type { ProviderProfile } from "./provider-types";

export type ProfilesPayload = { profiles: ProviderProfile[] };
export const emptyProfile: ProviderProfile = {
  id: "", name: "", baseUrl: "", model: "", generatePath: "", editPath: "",
  edits: true, multiImage: false, sendSize: false, seedField: "", hasKey: false,
};

export function gatewayProfile(baseUrl: string, defaultModel = ""): ProviderProfile {
  return { ...emptyProfile, name: "LiteLLM Gateway", baseUrl, model: defaultModel,
    seedField: defaultModel ? "seed" : "" };
}

const storageKey = (namespace: string) => "image-studio:providers:" + namespace;
const credentialKey = (namespace: string, profile: Pick<ProviderProfile, "id" | "baseUrl">) =>
  "image-studio:provider-key:" + JSON.stringify([namespace, profile.id, profile.baseUrl]);

export function profileKey(namespace: string, profile: Pick<ProviderProfile, "id" | "baseUrl">) {
  try { return localStorage.getItem(credentialKey(namespace, profile)) ?? ""; }
  catch { return ""; }
}

export function providerBase(value: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("請輸入有效的 Provider Base URL。"); }
  if (url.username || url.password || url.search || url.hash || !(url.protocol === "https:" ||
      url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new Error("請使用 HTTPS 或本機 HTTP Provider，URL 內請勿包含憑證或查詢參數。");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function providerEndpoint(baseUrl: string, path: string, fallback: string) {
  const base = providerBase(baseUrl);
  if (!path) return (base.endsWith("/v1") ? base : base + "/v1") + fallback;
  if (!path.startsWith("/") || path.startsWith("//") || /[\\?#\s]/.test(path)) {
    throw new Error("自訂端點請輸入同一 Provider 的絕對路徑。");
  }
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin) throw new Error("自訂端點必須與 Provider 同源。");
  return url.href;
}

function storedProfiles(namespace: string): ProviderProfile[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(storageKey(namespace)) ?? "[]");
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

export function readProfiles(namespace: string): ProfilesPayload {
  return { profiles: storedProfiles(namespace).map((profile) => ({ ...profile, hasKey: Boolean(profileKey(namespace, profile)) })) };
}

function writeProfiles(namespace: string, profiles: ProviderProfile[]) {
  localStorage.setItem(storageKey(namespace), JSON.stringify(profiles));
}

export function saveProfile(namespace: string, draft: ProviderProfile, key: string, clearKey: boolean) {
  const current = storedProfiles(namespace);
  const existing = current.find(({ id }) => id === draft.id);
  const baseUrl = providerBase(draft.baseUrl);
  const native = draft.nativeEnhanceField?.trim();
  if (native && (!/^[a-z][a-z0-9_]*$/.test(native) || !nativeFieldAllowed(native))) {
    throw new Error("請輸入有效的 Provider Native 增強欄位。");
  }
  const profile: ProviderProfile = {
    id: existing?.id ?? crypto.randomUUID(), name: draft.name.trim(), model: draft.model.trim(), baseUrl,
    generatePath: draft.generatePath.trim(), editPath: draft.editPath.trim(), edits: draft.edits, multiImage: draft.multiImage,
    sendSize: draft.sendSize, seedField: draft.seedField, hasKey: false, responsesModel: draft.responsesModel?.trim(),
    enhanceModel: draft.enhanceModel?.trim(), nativeEnhanceField: native, nativeEnhanceValueType: draft.nativeEnhanceValueType,
    imageCapabilities: parseImageCapabilities(draft.imageCapabilities ?? {}),
  };
  if (!profile.name) throw new Error("請輸入 Provider 名稱。");
  providerEndpoint(baseUrl, profile.generatePath, "/images/generations");
  providerEndpoint(baseUrl, profile.editPath, "/images/edits");
  const previousKey = existing?.baseUrl === baseUrl ? profileKey(namespace, existing) : "";
  const selectedKey = clearKey ? "" : key.trim() || previousKey;
  profile.hasKey = Boolean(selectedKey || (existing?.baseUrl === baseUrl && existing.hasKey && !clearKey));
  const keyId = credentialKey(namespace, profile);
  try {
    if (selectedKey) localStorage.setItem(keyId, selectedKey);
    else localStorage.removeItem(keyId);
    writeProfiles(namespace, existing ? current.map((item) => item.id === profile.id ? profile : item) : [...current, profile]);
  } catch (error) {
    if (previousKey) localStorage.setItem(keyId, previousKey);
    else localStorage.removeItem(keyId);
    throw error;
  }
  if (existing && existing.baseUrl !== baseUrl) localStorage.removeItem(credentialKey(namespace, existing));
  return readProfiles(namespace);
}

export function persistedKey(namespace: string, id: string) {
  return storedProfiles(namespace).some((profile) => profile.id === id && profile.hasKey);
}

export function deleteProfile(namespace: string, profile: ProviderProfile) {
  writeProfiles(namespace, storedProfiles(namespace).filter(({ id }) => id !== profile.id));
  localStorage.removeItem(credentialKey(namespace, profile));
  return readProfiles(namespace);
}

export const protectedField = /^(?:authorization|api.?key|token|password|secret|headers|images?|image\[\]|mask|stream|model|prompt|size|seed|noise_seed|__proto__|constructor|prototype)$/i;
function nativeFieldAllowed(field: string) {
  return !protectedField.test(field) && !["n", "background", "quality", "output_format", "response_format", "user"].includes(field);
}

export function nativeEnhanceSetting(profile: ProviderProfile) {
  const field = profile.nativeEnhanceField || "enhance_prompt";
  return { field, value: profile.nativeEnhanceValueType === "string" || !profile.nativeEnhanceField ? "true" : true };
}
