import { blobDataUrl, generationDefaults, ratios, workspaceBase, type Draft, type GenerationJob, type Picture, type Session, type Workspace } from "./model";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error("備份格式無效或版本不相容。");
}

export async function exportWorkspace(workspace: Workspace, session?: Session) {
  const sessions = session ? [session] : workspace.sessions;
  const drafts = Object.fromEntries(sessions.map(({ id }) => [id, workspace.drafts[id]]));
  const jobs = session ? workspace.jobs?.filter(({ sessionId }) => sessionId === session.id) : workspace.jobs;
  let assets = workspace.assets;
  if (session) {
    const resultIds = new Set(session.turns.map(({ image }) => image.id));
    assets = cleanUnusedAssets({ ...workspace, sessions, drafts, jobs, assets: workspacePictures(workspace) }, false)
      .filter(({ id }) => !resultIds.has(id));
  }
  const data = { version: 1, workspace: {
    ...workspace, sessions, drafts, assets, jobs, activeId: session?.id ?? workspace.activeId,
    ...(session ? { presets: {}, promptPresets: undefined, generationPresets: undefined,
      lastGeneration: undefined, lastProfileId: undefined, retentionDays: undefined } : {}),
  } };
  const blobs: Blob[] = [];
  const blobIndexes = new Map<Blob, number>();
  const json = JSON.stringify(data, (_, value: unknown) => {
    if (!(value instanceof Blob)) return value;
    let index = blobIndexes.get(value);
    if (index === undefined) {
      index = blobs.push(value) - 1;
      blobIndexes.set(value, index);
    }
    return { backupBlob: index };
  });
  const encoded = await Promise.all(blobs.map(blobDataUrl));
  const file = new Blob(['{"data":', json, ',"blobs":', JSON.stringify(encoded), '}'], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = session ? `image-studio-${session.id}.json` : "image-studio-backup.json";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importWorkspace(file: File): Promise<Workspace> {
  const envelope: unknown = JSON.parse(await file.text());
  requireValue(record(envelope) && Array.isArray(envelope.blobs) && record(envelope.data) && envelope.data.version === 1);
  const encoded: unknown[] = envelope.blobs;
  const blobs = encoded.map((value) => {
    requireValue(typeof value === "string");
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
    requireValue(match);
    return new Blob([Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0))], { type: match[1] });
  });
  function picture(value: unknown): Picture {
    requireValue(record(value) && typeof value.id === "string" && typeof value.title === "string"
      && typeof value.width === "number" && value.width > 0 && typeof value.height === "number" && value.height > 0
      && (value.parentId === undefined || typeof value.parentId === "string"));
    const source = value.source;
    const thumbnail = value.thumbnail;
    requireValue(thumbnail === undefined || record(thumbnail) && typeof thumbnail.backupBlob === "number" && blobs[thumbnail.backupBlob]);
    const preview = thumbnail === undefined ? undefined : blobs[thumbnail.backupBlob as number];
    if (typeof source === "string") {
      // 舊備份為根絕對路徑 /workspace/...，新備份含 BASE_URL 前綴；統一還原為相對路徑
      const normalized = source.startsWith(workspaceBase)
        ? source.slice(workspaceBase.length)
        : `workspace/${source.replace(/^\/?workspace\//, "")}`;
      requireValue(normalized === "workspace/shinjuku.webp" || normalized === "workspace/neon-street.webp");
      return { ...value, source: normalized, thumbnail: preview } as Picture;
    }
    requireValue(record(source) && typeof source.backupBlob === "number" && blobs[source.backupBlob]);
    return { ...value, source: blobs[source.backupBlob], thumbnail: preview } as Picture;
  }
  const data = envelope.data.workspace;
  requireValue(record(data) && Array.isArray(data.sessions) && data.sessions.length && typeof data.activeId === "string"
    && record(data.drafts) && record(data.presets));
  const validOverrides = (value: unknown) => value === undefined ||
    Array.isArray(value) && value.every((field) => field === "size" || field === "n");
  const validDate = (value: unknown): value is number | undefined => value === undefined ||
    typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
  const sessions: Session[] = data.sessions.map((item: unknown) => {
    requireValue(record(item) && typeof item.id === "string" && item.id.length
      && typeof item.title === "string" && Array.isArray(item.turns));
    requireValue(validDate(item.createdAt) && validDate(item.updatedAt));
    requireValue(item.generationDefaults === undefined || record(item.generationDefaults));
    const turns = item.turns.map((turn: unknown) => {
      requireValue(record(turn) && typeof turn.id === "string" && typeof turn.prompt === "string");
      requireValue(validDate(turn.createdAt));
      requireValue([turn.originalPrompt, turn.enhancedPrompt].every((prompt) => prompt === undefined || typeof prompt === "string"));
      if (turn.request !== undefined) requireValue(record(turn.request)
        && Array.isArray(turn.request.references) && turn.request.references.every((id) => typeof id === "string"));
      const provider = turn.provider;
      if (provider !== undefined) requireValue(record(provider) && typeof provider.name === "string"
        && typeof provider.model === "string" && record(provider.sent) && record(provider.sent.fields)
        && record(provider.response) && typeof provider.response.count === "number"
        && (provider.response.seed === undefined || Number.isFinite(provider.response.seed))
        && (provider.imageSeed === undefined || Number.isSafeInteger(provider.imageSeed))
        && (provider.revisedPrompt === undefined || typeof provider.revisedPrompt === "string"));
      return { ...turn, image: picture(turn.image) } as Session["turns"][number];
    });
    return { id: item.id, title: item.title, pinned: item.pinned === true, archived: item.archived === true, turns,
      createdAt: item.createdAt, updatedAt: item.updatedAt,
      followLatestImage: item.followLatestImage === true,
      generationDefaults: item.generationDefaults && savedGenerationDefaults(item.generationDefaults),
      profileId: typeof item.profileId === "string" ? item.profileId : undefined };
  });
  const ids = new Set(sessions.map(({ id }) => id));
  requireValue(ids.size === sessions.length && ids.has(data.activeId));
  const turns = sessions.flatMap((session) => session.turns);
  requireValue(new Set(turns.map(({ id }) => id)).size === turns.length
    && new Set(turns.map(({ image }) => image.id)).size === turns.length);
  function validResolution(value: unknown) {
    return record(value) && ["ratio", "mp", "custom"].includes(String(value.sizeMode))
      && typeof value.ratio === "string" && ratios.includes(value.ratio)
      && (value.ratioReferenceId === undefined || typeof value.ratioReferenceId === "string")
      && (value.fixedSize === undefined || typeof value.fixedSize === "string")
      && [value.ratioWidth, value.ratioHeight, value.ratioLongEdge].every((item) => item === undefined || Number.isFinite(item))
      && [value.width, value.height, value.megapixels].every(Number.isFinite);
  }
  function savedDraft(draft: unknown): Draft {
    requireValue(record(draft) && typeof draft.prompt === "string"
      && (draft.mode === "generate" || draft.mode === "edit") && Array.isArray(draft.references)
      && record(draft.extra) && record(draft.extra.generate) && record(draft.extra.edit)
      && (draft.extraOverrides === undefined || record(draft.extraOverrides)
        && validOverrides(draft.extraOverrides.generate) && validOverrides(draft.extraOverrides.edit))
      && ["off", "auto", "provider"].includes(String(draft.enhance))
      && validResolution(draft)
      && (draft.resolutionByMode === undefined || record(draft.resolutionByMode)
        && Object.entries(draft.resolutionByMode).every(([mode, size]) =>
          (mode === "generate" || mode === "edit") && validResolution(size)))
      && ["random", "fixed", "manual"].includes(String(draft.seedMode))
      && typeof draft.seed === "string"
      && (draft.fixedSeed === undefined || typeof draft.fixedSeed === "string")
      && (draft.profileOverride === undefined || draft.profileOverride === null || typeof draft.profileOverride === "string")
      && (draft.batchSize === undefined || [1, 2, 3, 4].includes(Number(draft.batchSize))));
    return { ...draft, references: draft.references.map(picture), mask: draft.mask === undefined ? undefined : picture(draft.mask) } as Draft;
  }
  function savedGenerationDefaults(settings: Record<string, unknown>) {
    return generationDefaults(savedDraft({ ...settings, prompt: "", mode: "generate", references: [], mask: undefined }));
  }
  const drafts = Object.fromEntries(Object.entries(data.drafts).map(([id, draft]) => {
    requireValue(ids.has(id));
    return [id, savedDraft(draft)];
  }));
  const presets = Object.fromEntries(Object.entries(data.presets).map(([name, preset]) => {
    requireValue(record(preset) && (preset.mode === "generate" || preset.mode === "edit") && record(preset.body)
      && (preset.name === undefined || typeof preset.name === "string")
      && validOverrides(preset.overrides));
    return [name, { mode: preset.mode, body: preset.body, name: preset.name, overrides: preset.overrides }];
  })) as Workspace["presets"];
  const promptPresets = data.promptPresets;
  requireValue(promptPresets === undefined || record(promptPresets) && Object.values(promptPresets).every((value) => typeof value === "string"));
  requireValue(data.generationPresets === undefined || record(data.generationPresets));
  const generationPresets = Object.fromEntries(Object.entries(data.generationPresets ?? {}).map(([id, preset]) => {
    requireValue(record(preset) && typeof preset.name === "string" && preset.name.trim().length > 0
      && preset.name.length <= 60 && record(preset.settings));
    return [id, { name: preset.name, settings: savedGenerationDefaults(preset.settings) }];
  }));
  requireValue(data.assets === undefined || Array.isArray(data.assets));
  requireValue(data.jobs === undefined || Array.isArray(data.jobs));
  const jobs = data.jobs?.map((job: unknown) => {
    requireValue(record(job) && typeof job.id === "string" && typeof job.sessionId === "string" && ids.has(job.sessionId)
      && typeof job.sessionTitle === "string" && ["queued", "running", "completed", "failed", "cancelled"].includes(String(job.status))
      && [job.attempts, job.createdAt, job.updatedAt].every(Number.isFinite)
      && (job.enhancedPrompt === undefined || typeof job.enhancedPrompt === "string")
      && (job.error === undefined || typeof job.error === "string")
      && (job.results === undefined || Array.isArray(job.results) && job.results.every((id) => typeof id === "string")));
    const request = job.request;
    requireValue(record(request) && typeof request.prompt === "string" && (request.mode === "generate" || request.mode === "edit")
      && ["off", "auto", "provider"].includes(String(request.enhance)) && record(request.extraBody)
      && validOverrides(request.extraOverrides)
      && [request.width, request.height, request.seed].every(Number.isFinite)
      && Array.isArray(request.references) && request.references.every((id) => typeof id === "string"));
    const profile = job.profile;
    requireValue(profile === undefined || record(profile) && typeof profile.id === "string"
      && typeof profile.model === "string" && typeof profile.name === "string"
      && (profile.revision === undefined || typeof profile.revision === "string"));
    const draft = savedDraft(job.draft);
    requireValue(request.mode === draft.mode && request.maskId === (draft.mode === "edit" ? draft.mask?.id : undefined)
      && request.references.length === draft.references.length
      && request.references.every((id, index) => draft.references[index].id === id));
    return { ...job, draft } as GenerationJob;
  });
  if (jobs) requireValue(new Set(jobs.map(({ id }) => id)).size === jobs.length);
  requireValue(data.lastGeneration === undefined || record(data.lastGeneration));
  requireValue(data.lastProfileId === undefined || data.lastProfileId === null || typeof data.lastProfileId === "string");
  const workspace: Workspace = { sessions, drafts, presets, promptPresets: promptPresets as Workspace["promptPresets"], generationPresets,
    activeId: data.activeId, assets: data.assets?.map(picture), jobs,
    lastGeneration: data.lastGeneration && savedGenerationDefaults(data.lastGeneration), lastProfileId: data.lastProfileId };
  const pictures = new Map(workspacePictures(workspace).map((picture) => [picture.id, picture]));
  const verified = new Set<string>();
  for (const image of pictures.values()) {
    const ancestors = new Set<string>();
    let current: Picture | undefined = image;
    while (current && !verified.has(current.id)) {
      requireValue(!ancestors.has(current.id));
      ancestors.add(current.id);
      const parentId: string | undefined = current.parentId;
      current = parentId === undefined ? undefined : pictures.get(parentId);
      requireValue(parentId === undefined || current);
    }
    for (const id of ancestors) verified.add(id);
  }
  for (const { request } of turns) {
    if (!request) continue;
    requireValue(request.references.every((id) => pictures.has(id))
      && (request.maskId === undefined || pictures.get(request.maskId)?.kind === "mask"));
  }
  const resultIds = new Map(sessions.map(({ id, turns }) => [id, new Set(turns.map(({ image }) => image.id))]));
  for (const job of jobs ?? []) {
    const sessionResults = resultIds.get(job.sessionId);
    requireValue(job.results?.every((id) => sessionResults?.has(id)) ?? true);
  }
  return workspace;
}

export function workspacePictures(workspace: Workspace): Picture[] {
  return [...new Map([
    ...Object.values(workspace.drafts).flatMap((draft) => draft ? [...draft.references, ...(draft.mask ? [draft.mask] : [])] : []),
    ...(workspace.jobs ?? []).flatMap(({ draft }) => [...draft.references, ...(draft.mask ? [draft.mask] : [])]),
    ...(workspace.assets ?? []),
    ...workspace.sessions.flatMap(({ turns }) => turns.map(({ image }) => image)),
  ].map((picture) => [picture.id, picture])).values()];
}

export function cleanUnusedAssets(workspace: Workspace, keepFavorites = true): Picture[] {
  const retained = new Set([
    ...Object.values(workspace.drafts).flatMap((draft) => draft ? [...draft.references.map(({ id }) => id), draft.mask?.id] : []),
    ...(workspace.jobs ?? []).flatMap(({ request }) => [...request.references, request.maskId]),
    ...workspace.sessions.flatMap(({ turns }) => turns.flatMap(({ image, request }) => [
      image.id, image.parentId, request?.maskId, ...(request?.references ?? []),
    ])),
  ]);
  const assets = workspace.assets ?? [];
  if (keepFavorites) {
    for (const { id, favorite } of assets) if (favorite) retained.add(id);
  }
  // Retain each ancestor of a surviving version, including branches whose original session was removed.
  const parentByAsset = new Map(assets.map(({ id, parentId }) => [id, parentId]));
  for (const id of retained) {
    if (!id) continue;
    const parentId = parentByAsset.get(id);
    if (parentId) retained.add(parentId);
  }
  return assets.filter(({ id }) => retained.has(id));
}
