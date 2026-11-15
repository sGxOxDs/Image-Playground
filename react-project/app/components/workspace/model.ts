import type { ProviderPreview, ProviderProfile, ProviderResult, ResponseContinuation } from "./provider-types";
import { applicationReferenceLimit, imageLimits, referenceLimit, sizeProblem, supportsMask, supportsSeed } from "./image-capabilities";

export type Mode = "generate" | "edit";
export type JsonObject = Record<string, unknown>;
export type ExtraOverride = "size" | "n";
export type ExtraOverrides = Partial<Record<Mode, ExtraOverride[]>>;
export type ImageSource = string | Blob;
export const pictureDragType = "application/x-image-studio-picture-id";
export const maxPromptLength = 32_000;

export function addReferences(previous: Picture[], next: Picture[]) {
  const unique = new Map([...previous, ...next].map((picture) => [picture.id, picture]));
  return [...unique.values()].slice(0, applicationReferenceLimit);
}

export type Picture = {
  id: string;
  title: string;
  source: ImageSource;
  thumbnail?: Blob;
  width: number;
  height: number;
  parentId?: string;
  favorite?: boolean;
  continuation?: ResponseContinuation;
  kind?: "mask";
};
export type RequestPreview = {
  mode: Mode;
  prompt: string;
  enhance: Draft["enhance"];
  width: number;
  height: number;
  seed: number;
  references: string[];
  maskId?: string;
  extraBody: JsonObject;
  extraOverrides?: ExtraOverride[];
};
export type Turn = {
  id: string;
  createdAt?: number;
  prompt: string;
  image: Picture;
  originalPrompt?: string;
  enhancedPrompt?: string;
  request?: RequestPreview;
  provider?: {
    name: string; model: string; sent: ProviderPreview; response: ProviderResult["response"];
    revisedPrompt?: string; imageSeed?: number;
  };
};
export type Session = {
  id: string; title: string; turns: Turn[]; pinned?: boolean; archived?: boolean; profileId?: string;
  createdAt?: number; updatedAt?: number; generationDefaults?: GenerationDefaults;
  followLatestImage?: boolean;
};
type ResolutionSettings = {
  ratio: string;
  ratioReferenceId?: string;
  ratioWidth?: number;
  ratioHeight?: number;
  ratioLongEdge?: number;
  megapixels: number;
  sizeMode: "ratio" | "mp" | "custom";
  width: number;
  height: number;
  fixedSize?: string;
};
export type Draft = ResolutionSettings & {
  prompt: string;
  mode: Mode;
  references: Picture[];
  enhance: "off" | "auto" | "provider";
  resolutionByMode?: Partial<Record<Mode, ResolutionSettings>>;
  seedMode: "random" | "fixed" | "manual";
  seed: string;
  fixedSeed?: string;
  extra: Record<Mode, JsonObject>;
  extraOverrides?: ExtraOverrides;
  useResponseContext?: boolean;
  batchSize?: number;
  mask?: Picture;
  profileOverride?: string | null;
};
export type GenerationDefaults = Omit<Draft, "prompt" | "mode" | "references" | "mask" | "profileOverride" | "ratioReferenceId">;
export type GenerationPreset = { name: string; settings: GenerationDefaults };
export type Workspace = {
  sessions: Session[];
  activeId: string;
  drafts: Partial<Record<string, Draft>>;
  presets: Record<string, { mode: Mode; body: JsonObject; overrides?: ExtraOverride[]; name?: string }>;
  promptPresets?: Record<string, string>;
  generationPresets?: Record<string, GenerationPreset>;
  assets?: Picture[];
  jobs?: GenerationJob[];
  lastGeneration?: GenerationDefaults;
  lastProfileId?: string | null;
  retentionDays?: number;
};

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type GenerationJob = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  draft: Draft;
  request: RequestPreview;
  enhancedPrompt?: string;
  profile?: ProviderProfile;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  error?: string;
  results?: string[];
};

const shinjuku = "/workspace/shinjuku.webp";
const neonStreet = "/workspace/neon-street.webp";
export const ratios = ["1:1", "3:2", "2:3", "16:9", "9:16", "4:3", "3:4", "21:9", "original", "reference", "custom"];

const generationResolution: ResolutionSettings = { ratio: "1:1", megapixels: 1, sizeMode: "custom", width: 1024, height: 1024 };
const defaultResolution: Record<Mode, ResolutionSettings> = {
  generate: generationResolution,
  edit: { ...generationResolution, ratio: "original", sizeMode: "mp" },
};

export const emptyDraft: Draft = {
  ...generationResolution,
  prompt: "", mode: "generate", references: [], enhance: "provider",
  resolutionByMode: {},
  seedMode: "random", seed: "", extra: { generate: {}, edit: {} },
};

function resolutionFields({ ratio, ratioReferenceId, ratioWidth, ratioHeight, ratioLongEdge, megapixels, sizeMode, width, height, fixedSize }: ResolutionSettings): ResolutionSettings {
  return { ratio, ratioReferenceId, ratioWidth, ratioHeight, ratioLongEdge, megapixels, sizeMode, width, height, fixedSize };
}

const resolutionKeys = Object.keys(resolutionFields(generationResolution));

function savedResolutions(draft: Draft): NonNullable<Draft["resolutionByMode"]> {
  if (draft.resolutionByMode) return draft.resolutionByMode;
  const size = resolutionFields(draft);
  const oldDefault = size.sizeMode === "ratio" && size.ratio === "3:2" && size.megapixels === 1.5
    && size.width === 1440 && size.height === 960 && size.ratioLongEdge === undefined && !size.fixedSize;
  if (oldDefault) return {};
  const mode = size.ratio === "original" || size.ratio === "reference" ? "edit" : draft.mode;
  return { [mode]: size };
}

export function resolutionForMode(draft: Draft, mode: Mode): Draft {
  const resolutionByMode = savedResolutions(draft);
  const size = resolutionByMode[mode] ?? defaultResolution[mode];
  return { ...draft, ...resolutionFields(size), mode, resolutionByMode };
}

export function updateDraftSettings(draft: Draft, change: Partial<Draft>): Draft {
  const current = automaticMode(draft);
  const next = { ...current, ...change };
  if (resolutionKeys.some((key) => Object.hasOwn(change, key))) {
    next.resolutionByMode = { ...current.resolutionByMode, [current.mode]: resolutionFields(next) };
  }
  return automaticMode(next);
}

export function generationDefaults(draft: Draft): GenerationDefaults {
  const { prompt, mode, references, mask, profileOverride, ratioReferenceId, ...settings } = draft;
  const resolutionByMode = savedResolutions(draft);
  const saved = { ...resolutionByMode };
  for (const target of ["generate", "edit"] as const) {
    const size = saved[target];
    if (size?.ratio !== "reference") continue;
    const basis = ratioBasis({ ...draft, ...size });
    saved[target] = { ...size, ratioReferenceId: undefined, ratio: basis ? "custom" : defaultResolution[target].ratio,
      ratioWidth: basis?.[0], ratioHeight: basis?.[1] };
  }
  return {
    ...settings,
    ...saved[mode],
    resolutionByMode: saved,
  };
}

function draftFromDefaults(settings?: GenerationDefaults): Draft {
  return settings ? { ...emptyDraft, ...settings, resolutionByMode: settings.resolutionByMode } : { ...emptyDraft };
}

export function sessionDraft(session: Session, lastGeneration?: GenerationDefaults): Draft {
  return draftFromDefaults(session.generationDefaults ?? lastGeneration);
}

export function automaticMode(draft: Draft): Draft {
  const mode = draft.references.length ? "edit" : "generate";
  const mask = draft.mask?.parentId === draft.references[0]?.id ? draft.mask : undefined;
  return resolutionForMode(mask === draft.mask ? draft : { ...draft, mask }, mode);
}

export function withImageSource(draft: Draft, image: Picture): Draft {
  return automaticMode({
    ...draft,
    references: [image, ...draft.references.slice(1).filter(({ id }) => id !== image.id)],
  });
}

export function restoreGenerationDefaults(draft: Draft, session: Session): Draft {
  const { prompt, mode, references, mask } = draft;
  return automaticMode({ ...draftFromDefaults(session.generationDefaults), prompt, mode, references, mask, profileOverride: undefined });
}

export const initialWorkspace: Workspace = {
  activeId: "shinjuku",
  drafts: {},
  presets: {},
  sessions: [
    {
      id: "shinjuku",
      title: "東京霓虹雨夜",
      turns: [
        {
          id: "neon-turn",
          prompt: "捕捉東京街頭的霓虹燈，讓招牌成為畫面的主角。",
          image: { id: "neon", title: "霓虹街道", source: neonStreet, width: 1100, height: 734 },
        },
        {
          id: "rain-turn",
          prompt: "把場景改成電影感的雨夜，保留街道構圖，強調地面的霓虹倒影。",
          image: { id: "rain", title: "雨中的新宿", source: shinjuku, width: 1440, height: 960, parentId: "neon" },
        },
      ],
    },
    { id: "product", title: "產品攝影", turns: [] },
    { id: "portfolio", title: "風格實驗", turns: [] },
  ],
};

export function ratioBasis(draft: Draft): [number, number] | undefined {
  if (draft.ratio === "custom") return [draft.ratioWidth ?? 0, draft.ratioHeight ?? 0];
  if (draft.ratio === "original" || draft.ratio === "reference") {
    const picture = draft.ratio === "original" ? draft.references[0]
      : draft.references.find(({ id }) => id === draft.ratioReferenceId);
    return picture && [picture.width, picture.height];
  }
  const [width, height] = draft.ratio.split(":").map(Number);
  return Number.isFinite(width) && Number.isFinite(height) ? [width, height] : undefined;
}

export function dimensions(draft: Draft, profile?: ProviderProfile): [number, number] {
  const { alignment, fixedSizes } = imageLimits(profile);
  if (fixedSizes.length) {
    const preferred = draft.fixedSize ?? (draft.mode === "generate" ? "1024x1024" : undefined);
    const size = fixedSizes.find((item) => item === preferred) ?? fixedSizes[0];
    const [w, h] = size.split("x").map(Number);
    return [w, h];
  }
  if (draft.sizeMode === "custom") return [draft.width, draft.height];
  const [w, h] = ratioBasis(draft) ?? [0, 0];
  if (!(w > 0 && h > 0)) return [0, 0];
  const scale = draft.sizeMode === "ratio" && draft.ratioLongEdge !== undefined
    ? draft.ratioLongEdge / Math.max(w, h)
    : Math.sqrt(draft.megapixels * 1_000_000 / (w * h));
  if (!Number.isFinite(scale) || scale <= 0) return [0, 0];
  return [Math.max(alignment, Math.round(w * scale / alignment) * alignment),
    Math.max(alignment, Math.round(h * scale / alignment) * alignment)];
}

export function draftProblem(draft: Draft, profile?: ProviderProfile): string {
  const prompt = draft.prompt.trim();
  if (!prompt) return "請輸入提示詞。";
  if (prompt.length > maxPromptLength) return "提示詞長度上限為 32,000 字元。";
  if (draft.mode === "edit" && !draft.references.length) return "請加入至少一張來源圖。";
  if (profile && draft.mode === "edit" && !profile.edits) return "此模型未啟用編輯。";
  if (profile?.imageCapabilities?.generate === false && draft.mode === "generate") return "此模型未啟用生成。";
  if (draft.references.length > referenceLimit(profile)) return `此模型最多接受 ${referenceLimit(profile)} 張參考圖。`;
  const invalidMask = maskProblem(draft, profile);
  if (invalidMask) return invalidMask;
  const invalidSize = resolutionProblem(draft, profile);
  if (invalidSize) return invalidSize;
  const { seedMin, seedMax } = imageLimits(profile);
  if (supportsSeed(profile) && draft.seedMode !== "random"
      && (!/^\d+$/.test(draft.seed) || Number(draft.seed) < seedMin || Number(draft.seed) > seedMax)) {
    return `請輸入 ${seedMin} 到 ${seedMax} 之間的整數 Seed。`;
  }
  return "";
}

export function maskProblem(draft: Draft, profile?: ProviderProfile): string {
  if (draft.mode !== "edit" || !draft.mask) return "";
  const source = draft.references[0];
  if (!supportsMask(profile)) return "此模型未啟用遮罩，請移除遮罩或切換模型。";
  if (!source || draft.mask.parentId !== source.id) return "來源圖已變更，請更換或移除遮罩。";
  if (draft.mask.width !== source.width || draft.mask.height !== source.height) return "遮罩須與第一張來源圖尺寸一致。";
  return "";
}

export function resolutionProblem(draft: Draft, profile?: ProviderProfile): string {
  if (profile && !profile.sendSize) return "";
  const allowsCustom = !imageLimits(profile).fixedSizes.length;
  const body = draft.extra[draft.mode];
  const sizeOverride = draft.extraOverrides?.[draft.mode]?.includes("size") && Object.hasOwn(body, "size");
  if (sizeOverride && !parseExtraSize(body.size)) return "Extra Body 的 size 須為「寬x高」，例如 1024x1024。";
  const { minEdge, maxEdge, maxPixels } = imageLimits(profile);
  const ratioLongEdge = draft.sizeMode === "ratio" ? draft.ratioLongEdge : undefined;
  if (!sizeOverride && allowsCustom && ratioLongEdge !== undefined
      && (!Number.isSafeInteger(ratioLongEdge) || ratioLongEdge < minEdge || ratioLongEdge > maxEdge)) {
    return `長邊尺寸須為 ${minEdge} 至 ${maxEdge} px 之間的整數。`;
  }
  if (!sizeOverride && allowsCustom && draft.sizeMode !== "custom"
      && ratioLongEdge === undefined
      && (!Number.isFinite(draft.megapixels) || draft.megapixels <= 0 || draft.megapixels > maxPixels / 1_000_000)) {
    return `像素預算須大於 0，且不超過 ${maxPixels / 1_000_000} MP。`;
  }
  if (!sizeOverride && allowsCustom && draft.sizeMode !== "custom") {
    const basis = ratioBasis(draft);
    if (!basis) return "請加入或選擇比例基準圖。";
    if (basis.some((value) => !Number.isSafeInteger(value) || value < 1)) return "自訂比例須為兩個正整數。";
  }
  const [width, height] = requestDimensions(draft, profile);
  return sizeProblem(width, height, profile);
}

export function parseExtraSize(value: unknown): [number, number] | undefined {
  const match = typeof value === "string" && /^(\d{1,6})x(\d{1,6})$/.exec(value);
  if (match) return [Number(match[1]), Number(match[2])];
}

export function requestDimensions(draft: Draft, profile?: ProviderProfile): [number, number] {
  if (profile && !profile.sendSize) return [1024, 1024];
  const size = draft.extraOverrides?.[draft.mode]?.includes("size") && parseExtraSize(draft.extra[draft.mode].size);
  return size || dimensions(draft, profile);
}

export function requestExtraBody(draft: Draft) {
  const body = draft.extra[draft.mode];
  return draft.batchSize && !draft.extraOverrides?.[draft.mode]?.includes("n") ? { ...body, n: draft.batchSize } : body;
}

export function randomSeed(profile?: ProviderProfile) {
  const { seedMin, seedMax } = imageLimits(profile);
  return seedMin + Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * (seedMax - seedMin + 1));
}

export function requestPreview(draft: Draft, prompt = draft.prompt.trim(), profile?: ProviderProfile): RequestPreview {
  const [width, height] = requestDimensions(draft, profile);
  const seed = draft.seedMode !== "random" && supportsSeed(profile) ? Number(draft.seed) : randomSeed(profile);
  const body = draft.extra[draft.mode];
  const extraOverrides = draft.extraOverrides?.[draft.mode]?.filter((field) => Object.hasOwn(body, field));
  return {
    mode: draft.mode, prompt, enhance: draft.enhance, width, height,
    seed,
    references: draft.references.map((picture) => picture.id),
    maskId: draft.mode === "edit" ? draft.mask?.id : undefined,
    extraBody: requestExtraBody(draft),
    extraOverrides,
  };
}

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function imageSize(source: ImageSource): Promise<{ width: number; height: number }> {
  const image = await loadImage(source);
  return { width: image.naturalWidth, height: image.naturalHeight };
}

export async function imagePreview(source: Blob): Promise<Pick<Picture, "width" | "height" | "thumbnail">> {
  const image = await loadImage(source);
  const { naturalWidth: width, naturalHeight: height } = image;
  const scale = Math.min(1, 320 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return { width, height };
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const thumbnail = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.8));
  return { width, height, thumbnail: thumbnail ?? undefined };
}

async function loadImage(source: ImageSource): Promise<HTMLImageElement> {
  const image = new Image();
  const url = typeof source === "string" ? source : URL.createObjectURL(source);
  try {
    image.src = url;
    await image.decode();
    return image;
  } finally {
    if (typeof source !== "string") URL.revokeObjectURL(url);
  }
}

export async function renderDemo(draft: Draft, request: RequestPreview): Promise<Blob> {
  const reference = draft.references[0];
  const source = reference?.source ?? (request.seed % 2 === 0 ? shinjuku : neonStreet);
  const image = await loadImage(source);
  const canvas = document.createElement("canvas");
  canvas.width = request.width;
  canvas.height = request.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("無法建立圖片預覽。");
  context.fillStyle = "#18181b";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  context.filter = `hue-rotate(${20 + (request.seed % 73)}deg) saturate(1.22) contrast(1.08)`;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  const format = request.extraBody.output_format;
  const mime = format === "webp" ? "image/webp" : format === "jpeg" ? "image/jpeg" : "image/png";
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error("無法輸出圖片。"));
  }, mime));
}
