import { workspacePictures } from "./backup";
import type { Draft, GenerationJob, Picture, Session, Turn, Workspace } from "./model";

type StoredDraft = Omit<Draft, "references" | "mask"> & { referenceIds: string[]; maskId?: string };
type StoredJob = Omit<GenerationJob, "draft"> & { draft: StoredDraft };
type StoredMessage = Omit<Turn, "image"> & { imageId: string };
type StoredSession = Omit<Session, "turns"> & { turnIds: string[] };
type StoredPreset =
  | { kind: "body"; name: string; value: Workspace["presets"][string] }
  | { kind: "prompt"; name: string; value: string }
  | { kind: "generation"; name: string; value: NonNullable<Workspace["generationPresets"]>[string] };
type WorkspaceIndex = Pick<Workspace, "activeId" | "lastGeneration" | "lastProfileId" | "retentionDays">
  & { sessionIds: string[]; assetIds?: string[]; jobIds?: string[] };

const stores = ["workspace", "sessions", "messages", "images", "generation_runs", "presets", "drafts"] as const;
const [meta, ...records] = stores;

function openWorkspace(namespace: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("image-studio-" + namespace, 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      for (const store of stores) {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("請先關閉其他開啟工作台的分頁。"));
    };
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeDraft({ references, mask, ...draft }: Draft): StoredDraft {
  return { ...draft, referenceIds: references.map(({ id }) => id), maskId: mask?.id };
}

function required<T>(index: Map<string, T>, id: string): T {
  const value = index.get(id);
  if (value === undefined) throw new Error("本機資料的引用不完整。");
  return value;
}

export async function readWorkspace(namespace = "standalone"): Promise<Workspace | undefined> {
  const db = await openWorkspace(namespace);
  try {
    const transaction = db.transaction(stores);
    const metadata = transaction.objectStore(meta);
    const [index, legacy, sessions, messages, pictures, runs, presets, drafts] = await Promise.all([
      result<WorkspaceIndex | undefined>(metadata.get("index")),
      result<Workspace | undefined>(metadata.get("current")),
      result<StoredSession[]>(transaction.objectStore("sessions").getAll()),
      result<StoredMessage[]>(transaction.objectStore("messages").getAll()),
      result<Picture[]>(transaction.objectStore("images").getAll()),
      result<StoredJob[]>(transaction.objectStore("generation_runs").getAll()),
      result<StoredPreset[]>(transaction.objectStore("presets").getAll()),
      result<{ id: string; draft: StoredDraft }[]>(transaction.objectStore("drafts").getAll()),
    ]);
    if (!index) return legacy;
    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const turnsById = new Map(messages.map((message) => [message.id, message]));
    const picturesById = new Map(pictures.map((picture) => [picture.id, picture]));
    const runsById = new Map(runs.map((run) => [run.id, run]));
    function restoreDraft({ referenceIds, maskId, ...draft }: StoredDraft): Draft {
      return { ...draft, references: referenceIds.map((id) => required(picturesById, id)),
        mask: maskId === undefined ? undefined : required(picturesById, maskId) };
    }
    return {
      activeId: index.activeId,
      lastGeneration: index.lastGeneration,
      lastProfileId: index.lastProfileId,
      retentionDays: index.retentionDays,
      sessions: index.sessionIds.map((id) => {
        const { turnIds, ...session } = required(sessionsById, id);
        return { ...session, turns: turnIds.map((turnId) => {
          const { imageId, ...turn } = required(turnsById, turnId);
          return { ...turn, image: required(picturesById, imageId) };
        }) };
      }),
      assets: index.assetIds?.map((id) => required(picturesById, id)),
      jobs: index.jobIds?.map((id) => {
        const { draft, ...run } = required(runsById, id);
        return { ...run, draft: restoreDraft(draft) };
      }),
      drafts: Object.fromEntries(drafts.map(({ id, draft }) => [id, restoreDraft(draft)])),
      presets: Object.fromEntries(presets.flatMap((preset) => preset.kind === "body" ? [[preset.name, preset.value]] : [])),
      promptPresets: Object.fromEntries(presets.flatMap((preset) => preset.kind === "prompt" ? [[preset.name, preset.value]] : [])),
      generationPresets: Object.fromEntries(presets.flatMap((preset) => preset.kind === "generation" ? [[preset.name, preset.value]] : [])),
    };
  } finally {
    db.close();
  }
}

export async function writeWorkspace(workspace: Workspace, namespace = "standalone"): Promise<void> {
  const db = await openWorkspace(namespace);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(stores, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      try {
        for (const store of records) transaction.objectStore(store).clear();
        const metadata = transaction.objectStore(meta);
        const index: WorkspaceIndex = {
          activeId: workspace.activeId,
          lastGeneration: workspace.lastGeneration,
          lastProfileId: workspace.lastProfileId,
          retentionDays: workspace.retentionDays,
          sessionIds: workspace.sessions.map(({ id }) => id),
          assetIds: workspace.assets?.map(({ id }) => id),
          jobIds: workspace.jobs?.map(({ id }) => id),
        };
        metadata.put(index, "index");
        metadata.delete("current");
        const sessions = transaction.objectStore("sessions");
        const messages = transaction.objectStore("messages");
        for (const { turns, ...session } of workspace.sessions) {
          const record: StoredSession = { ...session, turnIds: turns.map(({ id }) => id) };
          sessions.put(record, session.id);
          for (const { image, ...turn } of turns) {
            const message: StoredMessage = { ...turn, imageId: image.id };
            messages.put(message, turn.id);
          }
        }
        const images = transaction.objectStore("images");
        for (const picture of workspacePictures(workspace)) images.put(picture, picture.id);
        const runs = transaction.objectStore("generation_runs");
        for (const { draft, ...job } of workspace.jobs ?? []) {
          const record: StoredJob = { ...job, draft: storeDraft(draft) };
          runs.put(record, job.id);
        }
        const drafts = transaction.objectStore("drafts");
        for (const [id, draft] of Object.entries(workspace.drafts)) {
          if (draft) drafts.put({ id, draft: storeDraft(draft) }, id);
        }
        const presets = transaction.objectStore("presets");
        for (const [name, value] of Object.entries(workspace.presets)) {
          const record: StoredPreset = { kind: "body", name, value };
          presets.put(record, ["body", name]);
        }
        for (const [name, value] of Object.entries(workspace.promptPresets ?? {})) {
          const record: StoredPreset = { kind: "prompt", name, value };
          presets.put(record, ["prompt", name]);
        }
        for (const [id, value] of Object.entries(workspace.generationPresets ?? {})) {
          const record: StoredPreset = { kind: "generation", name: id, value };
          presets.put(record, ["generation", id]);
        }
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}
