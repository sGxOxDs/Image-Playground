export type ImageCapabilities = {
  responsesBackground?: boolean;
  partialImages?: number;
  generate?: boolean;
  mask?: boolean;
  referenceLimit?: number;
  alignment?: number;
  minEdge?: number;
  maxEdge?: number;
  maxPixels?: number;
  maxAspect?: number;
  fixedSizes?: string[];
  seedMin?: number;
  seedMax?: number;
};

export type ProviderProfile = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  generatePath: string;
  editPath: string;
  edits: boolean;
  multiImage: boolean;
  sendSize: boolean;
  seedField: string;
  hasKey: boolean;
  revision?: string;
  responsesModel?: string;
  enhanceModel?: string;
  nativeEnhanceField?: string;
  nativeEnhanceValueType?: "string";
  imageCapabilities?: ImageCapabilities;
};

export type ResponseContinuation = { id: string; proof: string };

export type ProviderPreview = {
  url: string;
  headers: Record<string, string>;
  encoding: "json" | "multipart";
  fields: Record<string, unknown>;
  conflicts: string[];
};

export type ProviderResult = {
  images: { blob: Blob; revisedPrompt?: string; seed?: number }[];
  preview: ProviderPreview;
  response: { count: number; created?: number; seed?: number; id?: string; body?: unknown };
  continuation?: ResponseContinuation;
};

export type ImageProgress =
  | { type: "partial"; count: number }
  | { type: "background"; ticket: string; status: "queued" | "in_progress" };
