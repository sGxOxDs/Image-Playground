import type { ImageCapabilities, ProviderProfile } from "./provider-types";

export const applicationReferenceLimit = 8;
type ProfileLimits = Pick<ProviderProfile, "multiImage" | "imageCapabilities" | "seedField" | "responsesModel" | "edits">;

export function referenceLimit(profile?: ProfileLimits) {
  return profile?.multiImage ? profile.imageCapabilities?.referenceLimit ?? applicationReferenceLimit : profile ? 1 : applicationReferenceLimit;
}

export function imageLimits(profile?: ProfileLimits) {
  return { alignment: 16, minEdge: 16, maxEdge: profile ? 4096 : 3072, maxPixels: profile ? 16_777_216 : 6_000_000,
    maxAspect: 256, fixedSizes: [], seedMin: 0, seedMax: 4294967295, ...profile?.imageCapabilities };
}

export function sizeProblem(width: number, height: number, profile?: ProfileLimits) {
  const { alignment, minEdge, maxEdge, maxPixels, maxAspect, fixedSizes } = imageLimits(profile);
  if (fixedSizes.length) {
    return fixedSizes.includes(`${width}x${height}`) ? "" : "請選擇模型支援的固定尺寸。";
  }
  if (![width, height].every((value) => Number.isInteger(value) && value >= minEdge && value <= maxEdge)) {
    return `長寬必須介於 ${minEdge} 至 ${maxEdge} px。`;
  }
  if (width % alignment !== 0 || height % alignment !== 0) return `長寬必須為 ${alignment} 的倍數。`;
  if (width * height > maxPixels) return `輸出不能超過 ${maxPixels / 1_000_000} MP。`;
  if (Math.max(width, height) / Math.min(width, height) > maxAspect) return `長寬比不可超過 ${maxAspect}:1。`;
  return "";
}

export function supportsSeed(profile?: ProfileLimits) {
  return !profile || Boolean(profile.seedField && !profile.responsesModel);
}

export function supportsMask(profile?: ProfileLimits) {
  return Boolean(profile?.edits && profile.imageCapabilities?.mask);
}

export function partialImageCount(profile: ProfileLimits, fields: Record<string, unknown>) {
  const format = fields.output_format;
  return !profile.responsesModel && (fields.n === undefined || fields.n === 1)
    && (format === undefined || format === "png" || format === "jpeg" || format === "webp")
    ? profile.imageCapabilities?.partialImages ?? 0 : 0;
}

export function parseImageCapabilities(value: unknown): ImageCapabilities {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模型能力格式無效。");
  const input = value as Record<string, unknown>;
  const parsed: ImageCapabilities = {};
  const integer = (name: keyof ImageCapabilities, min: number, max: number) => {
    const item = input[name];
    if (item === undefined) return undefined;
    if (typeof item !== "number" || !Number.isInteger(item) || item < min || item > max) {
      throw new Error(`模型能力欄位 ${name} 超出可用範圍。`);
    }
    return item;
  };
  for (const key of ["generate", "mask", "responsesBackground"] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "boolean") throw new Error(`模型能力欄位 ${key} 需要布林值。`);
      parsed[key] = input[key];
    }
  }
  const numeric = {
    referenceLimit: [1, applicationReferenceLimit], alignment: [1, 4096], minEdge: [1, 4096],
    maxEdge: [1, 4096], maxPixels: [1, 16_777_216], maxAspect: [1, 4096],
    seedMin: [0, 4294967295], seedMax: [0, 4294967295],
    partialImages: [0, 3],
  } as const;
  for (const [name, [min, max]] of Object.entries(numeric) as [keyof typeof numeric, readonly [number, number]][]) {
    const size = integer(name, min, max);
    if (size !== undefined) parsed[name] = size;
  }
  if ((parsed.minEdge ?? 16) > (parsed.maxEdge ?? 4096)
      || (parsed.seedMin ?? 0) > (parsed.seedMax ?? 4294967295)) {
    throw new Error("最小值不可大於最大值。");
  }
  if (input.fixedSizes !== undefined) {
    if (!Array.isArray(input.fixedSizes) || input.fixedSizes.length > 32 || input.fixedSizes.some((size: unknown) => {
      if (typeof size !== "string" || !/^[1-9]\d{0,3}x[1-9]\d{0,3}$/.test(size)) return true;
      return size.split("x").some((edge) => Number(edge) > 4096);
    })) throw new Error("固定尺寸請使用如 1024x1024 的格式。");
    parsed.fixedSizes = [...new Set(input.fixedSizes)];
  }
  return parsed;
}
