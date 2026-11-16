import { useEffect, useRef, useState } from "react";
import { AppLayout, ConversationPanel, FunctionRail } from "../layout/AppLayout";
import { MobileDrawer } from "../layout/MobileDrawer";
import { SessionSidebar } from "../layout/SessionSidebar";
import { ImageHistoryPanel, type HistoryView } from "../layout/ImageHistoryPanel";
import { PromptComposer, type AttachmentIssue } from "../composer/PromptComposer";
import { ExtraBodyPanel } from "../composer/ExtraBodyPanel";
import { cleanUnusedAssets, exportWorkspace, workspacePictures } from "./backup";
import { ImageComparison, Viewer } from "./ImageInspect";
import { ManageData, ManageSession } from "./ManageWorkspace";
import { ProviderSettings } from "./ProviderSettings";
import { cancelProviderJob, ProviderJobCancelled, requestEnhancedPrompt } from "./provider-client";
import { persistedKey, readProfiles, type ProfilesPayload } from "./provider-profiles";
import { executeJob, interruptPendingJobs, isRunningBackgroundJob, type GenerationProgress } from "./generation-queue";
import { applicationReferenceLimit, supportsMask } from "./image-capabilities";
import { maskHeaderSize } from "./mask-format";
import { useStandaloneApp } from "./useStandaloneApp";
import { useConversationScroll } from "./useConversationScroll";
import { AppearanceSettings } from "./appearance";
import { ShortcutHelp, useWorkspaceShortcuts } from "./Shortcuts";
import { CancelJobButton, jobStatusLabel, jobTones, JobProgress, QueuePanel } from "./QueuePanel";
import type { PluginConnection } from "./WorkspaceEntry";
import { addReferences, automaticMode, draftProblem, generationDefaults, imagePreview, imageSize, initialWorkspace, maxPromptLength, requestPreview,
  restoreGenerationDefaults, sessionDraft, updateDraftSettings, withImageSource,
  type Draft, type GenerationJob, type Picture, type Session, type Turn, type Workspace } from "./model";
import { readWorkspace, writeWorkspace } from "./storage";
import { defaultRetentionDays, pruneExpiredSessions, removeSessions } from "./session-retention";
import { Icon, IconButton, PanelDialog, PictureImage, StatusMark } from "./ui";
import "./workspace.css";

type Panel = "sessions" | "history" | "menu" | "gallery" | "provider" | "settings" | "extra" | "enhance" | "manage-session" | "manage-data" | "queue" | "shortcuts";

export function WorkspaceView({ plugin }: { plugin?: PluginConnection }) {
  const { online, canInstall, install } = useStandaloneApp(!plugin);
  const [workspace, setWorkspace] = useState<Workspace>(() => plugin
    ? { sessions: [{ id: "new", title: "新會話", turns: [] }], activeId: "new", drafts: {}, presets: {} }
    : initialWorkspace);
  const [ready, setReady] = useState(false);
  const [waitingForWorkspace, setWaitingForWorkspace] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [notice, setNotice] = useState("");
  const [attachmentUpload, setAttachmentUpload] = useState<{
    sessionId: string; rejected: AttachmentIssue[]; imported: Pick<Picture, "id" | "title">[];
  }>();
  const [maskUploadIssue, setMaskUploadIssue] = useState<{ sessionId: string; sourceId?: string; message: string }>();
  const maskUploads = useRef(new Map<string, symbol>());
  const [panel, setPanel] = useState<Panel | null>(null);
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(true);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [historyView, setHistoryView] = useState<HistoryView>("grid");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ ids: string[]; sourcePair?: true }>();
  const [showEarlier, setShowEarlier] = useState(false);
  const [candidate, setCandidate] = useState("");
  const [suggestedPrompt, setSuggestedPrompt] = useState("");
  const [enhanceStatus, setEnhanceStatus] = useState("");
  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const enhanceToken = useRef<AbortController | null>(null);
  const worker = useRef<{ id: string; controller: AbortController } | null>(null);
  const [workerCycle, setWorkerCycle] = useState(0);
  const [progress, setProgress] = useState<{ id: string; update: GenerationProgress }>();
  const [cancellingId, setCancellingId] = useState<string>();
  const [providers, setProviders] = useState<ProfilesPayload>({ profiles: [] });
  const [details, setDetails] = useState<Turn["provider"]>();
  const saveQueue = useRef(Promise.resolve());

  const appRef = useRef<HTMLDivElement>(null);
  const shortcuts = useWorkspaceShortcuts(appRef, ready, { n: () => newSession(), p: focusComposer, t: () => setPanel("queue") });
  const session = workspace.sessions.find(({ id }) => id === workspace.activeId) ?? workspace.sessions[0];
  const namespace = plugin?.namespace ?? "standalone";
  const savedDraft = automaticMode(workspace.drafts[session.id] ?? sessionDraft(session, workspace.lastGeneration));
  const selectedProfileId = savedDraft.profileOverride === null ? undefined : savedDraft.profileOverride ?? session.profileId;
  const profileRequired = Boolean(plugin || selectedProfileId);
  const savedProfile = selectedProfileId
    ? providers.profiles.find(({ id }) => id === selectedProfileId)
    : plugin ? providers.profiles[0] : undefined;
  const sharedBase = plugin?.sharedGateway ? window.location.origin + "/api/gateway" : undefined;
  const profile = savedProfile && sharedBase ? { ...savedProfile, baseUrl: sharedBase, generatePath: "", editPath: "" } : savedProfile;
  const draft: Draft = savedDraft.enhance === "provider" && (!profile || profile.responsesModel)
    ? { ...savedDraft, enhance: "off" } : savedDraft;
  const retentionDays = workspace.retentionDays ?? defaultRetentionDays;
  const jobs = workspace.jobs ?? [];
  const pendingJobs = jobs.filter(({ status }) => status === "queued" || status === "running");
  const providerLabel = plugin ? "LiteLLM Gateway" : "Provider";
  const gatewayStatus = !online ? "離線" : plugin?.sharedGateway ? profile?.model || "設定模型" : profile?.hasKey ? profile.model : "設定 Virtual Key";
  const positions = new Map(jobs.filter(({ status }) => status === "queued").map(({ id }, index) => [id, index + 1]));
  const sessionJobs = jobs.filter(({ sessionId }) => sessionId === session.id);
  const visibleJob = sessionJobs.find(({ status }) => status === "running")
    ?? sessionJobs.find(({ status }) => status === "queued") ?? sessionJobs.at(-1);
  const last = session.turns.at(-1);
  const conversationScroll = useConversationScroll(session.id, last?.id, showEarlier);
  const visibleTurn = conversationScroll.visibleId === last?.id ? last
    : session.turns.find(({ id }) => id === conversationScroll.visibleId);
  const pictures = workspacePictures(workspace);
  const libraryPictures = pictures.filter(({ kind }) => kind !== "mask");
  const viewer = pictures.find(({ id }) => id === viewerId);
  const viewerParent = viewer?.parentId ? pictures.find(({ id }) => id === viewer.parentId) : undefined;
  function versionInfo(id: string) {
    for (const item of workspace.sessions) {
      const index = item.turns.findIndex(({ image }) => image.id === id);
      if (index !== -1) return { turn: item.turns[index], label: `V${index + 1}` };
    }
  }
  const viewerInfo = viewer ? versionInfo(viewer.id) : undefined;
  const comparisons = compare?.ids.flatMap((id, index) => {
    const picture = pictures.find((item) => item.id === id);
    if (!picture) return [];
    const label = versionInfo(id)?.label;
    const role = compare.sourcePair ? (index === 0 ? "來源圖" : "編輯結果") : "";
    return [{ picture, label: [role, label].filter(Boolean).join(" · ") || picture.title }];
  });
  const sessionVersionIds = new Set(session.turns.map(({ image }) => image.id));
  const sessionReferenceIds = new Set([
    ...draft.references.map(({ id }) => id),
    ...session.turns.flatMap(({ image, request }) => [...(request?.references ?? []), image.parentId]),
    ...sessionJobs.flatMap(({ request }) => request.references),
  ]);
  const sessionReferences = libraryPictures.filter(({ id }) => sessionReferenceIds.has(id) && !sessionVersionIds.has(id));
  const sessionPictures = new Map([
    ...session.turns.map(({ image }) => [image.id, image] as const),
    ...sessionReferences.map((picture) => [picture.id, picture] as const),
  ]);
  const sessionImageCount = sessionVersionIds.size + sessionReferences.length;
  const selected = selectedIds.map((id) => sessionPictures.get(id))
    .filter((picture): picture is Picture => !!picture);
  const sourceVersion = draft.mode === "edit" && draft.references[0] ? versionInfo(draft.references[0].id)?.label : undefined;
  const attachmentIssues = attachmentUpload?.sessionId === session.id ? [
    ...attachmentUpload.rejected,
    ...attachmentUpload.imported.filter(({ id }) => !draft.references.some((reference) => reference.id === id))
      .map(({ title }) => ({ filename: title, reason: "已存入圖片庫，Composer 的參考圖已滿。" })),
  ] : [];

  useEffect(() => {
    const lifetime = new AbortController();
    const queue = saveQueue;
    let release: (() => void) | undefined;

    async function load() {
      if (lifetime.signal.aborted) return;
      setWaitingForWorkspace(false);
      try {
        const saved = await readWorkspace(namespace);
        if (saved && !lifetime.signal.aborted) setWorkspace(pruneExpiredSessions(interruptPendingJobs(saved)));
      } catch {
        if (!lifetime.signal.aborted) setStorageError(true);
      } finally {
        if (!lifetime.signal.aborted) setReady(true);
      }
    }

    async function hold() {
      if (lifetime.signal.aborted) return;
      const held = new Promise<void>((resolve) => { release = resolve; });
      await load();
      await held;
    }

    const locks = navigator.locks;
    if (locks) {
      const name = `image-studio-workspace:${namespace}`;
      void locks.request(name, { ifAvailable: true }, async (lock) => {
        if (lock) await hold();
        else if (!lifetime.signal.aborted) setWaitingForWorkspace(true);
      }).then(async () => {
        if (!release && !lifetime.signal.aborted) await locks.request(name, { signal: lifetime.signal }, hold);
      }).catch(() => { void load(); });
    } else {
      void load();
    }

    return () => {
      lifetime.abort();
      if (release) void queue.current.finally(release);
    };
  }, [namespace]);

  useEffect(() => {
    if (!ready || !retentionDays) return;
    const timer = window.setInterval(() => setWorkspace((current) => pruneExpiredSessions(current)), 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [ready, retentionDays]);

  useEffect(() => {
    setProviders(readProfiles(namespace));
  }, [namespace]);

  useEffect(() => () => {
    worker.current?.controller.abort();
    worker.current = null;
    enhanceToken.current?.abort();
    enhanceToken.current = null;
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => appRef.current?.style.setProperty("--ws-viewport-height", `${viewport.height}px`);
    resize();
    viewport.addEventListener("resize", resize);
    return () => viewport.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    if (!ready || storageError) return;
    saveQueue.current = saveQueue.current.then(() => writeWorkspace(workspace, namespace))
      .catch(() => setStorageError(true));
  }, [ready, storageError, workspace, namespace]);

  useEffect(() => {
    const job = workspace.jobs?.find(({ status }) => status === "queued");
    if (!ready || !job || worker.current) return;
    const controller = new AbortController();
    worker.current = { id: job.id, controller };
    const modify = (update: (current: GenerationJob) => GenerationJob) =>
      setWorkspace((current) => ({ ...current, jobs: current.jobs?.map((item) => item.id === job.id ? update(item) : item) }));
    modify((item) => ({ ...item, status: "running", attempts: item.attempts + 1, updatedAt: Date.now() }));

    async function process(next: GenerationJob) {
      try {
        await saveQueue.current;
        controller.signal.throwIfAborted();
        if (next.profile && !navigator.onLine) throw new Error("Provider 需要網路連線。");
        const job = next.profile && sharedBase ? { ...next, profile: { ...next.profile, baseUrl: sharedBase, generatePath: "", editPath: "" } } : next;
        const turns = await executeJob(job, controller.signal, namespace, (update) => {
          if (!controller.signal.aborted) setProgress({ id: next.id, update });
        }, plugin);
        if (controller.signal.aborted) return;
        setWorkspace((current) => {
          if (!current.jobs?.some((item) => item.id === next.id && item.status === "running")) return current;
          const target = current.sessions.find(({ id }) => id === next.sessionId);
          const latest = turns.at(-1)?.image;
          return { ...current,
            jobs: current.jobs.map((item) => item.id === next.id
              ? { ...item, status: "completed", error: undefined, results: turns.map(({ image }) => image.id), updatedAt: Date.now() } : item),
            sessions: current.sessions.map((item) => {
              if (item.id !== next.sessionId) return item;
              const existing = new Set(item.turns.map(({ id }) => id));
              return { ...item, updatedAt: Date.now(),
                title: item.turns.length || item.title !== "新會話" ? item.title : next.draft.prompt.trim().slice(0, 24),
                turns: [...item.turns, ...turns.filter(({ id }) => !existing.has(id))] };
            }),
            drafts: target?.followLatestImage && latest
              ? { ...current.drafts, [target.id]: withImageSource(
                current.drafts[target.id] ?? sessionDraft(target, current.lastGeneration), latest) }
              : current.drafts,
          };
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ProviderJobCancelled) {
          modify((item) => ({ ...item, status: "cancelled", error: undefined, updatedAt: Date.now() }));
          return;
        }
        modify((item) => ({ ...item, status: "failed", updatedAt: Date.now(),
          error: error instanceof Error ? error.message : "圖片處理失敗。" }));
      } finally {
        if (worker.current?.controller === controller) {
          setProgress(undefined);
          worker.current = null;
          // Wake the worker if a cancelled request settled after other jobs were queued.
          setWorkerCycle((cycle) => cycle + 1);
        }
      }
    }
    void process(job);
  }, [ready, workspace.jobs, namespace, workerCycle, plugin, sharedBase]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    function closeMobile(event: MediaQueryListEvent) {
      if (event.matches) setPanel((current) => current === "history" || current === "sessions" || current === "menu" ? null : current);
    }
    desktop.addEventListener("change", closeMobile);
    return () => desktop.removeEventListener("change", closeMobile);
  }, []);

  function updateDraft(change: Partial<Draft>) {
    setWorkspace((current) => {
      const next = updateDraftSettings(current.drafts[session.id] ?? sessionDraft(session, current.lastGeneration), change);
      const { prompt, references, mask, profileOverride, ...settings } = change;
      return { ...current, drafts: { ...current.drafts, [session.id]: next },
        lastGeneration: Object.keys(settings).length ? generationDefaults(next) : current.lastGeneration };
    });
  }

  function toggleFollowLatestImage() {
    setWorkspace((current) => {
      const target = current.sessions.find(({ id }) => id === session.id);
      if (!target) return current;
      const followLatestImage = !target.followLatestImage;
      const latest = target.turns.at(-1)?.image;
      return { ...current,
        sessions: current.sessions.map((item) => item === target ? { ...item, followLatestImage } : item),
        drafts: followLatestImage && latest
          ? { ...current.drafts, [target.id]: withImageSource(
            current.drafts[target.id] ?? sessionDraft(target, current.lastGeneration), latest) }
          : current.drafts,
      };
    });
  }

  function switchSession(id: string) {
    setWorkspace((current) => ({ ...current, activeId: id }));
    setSelectedIds([]);
    setShowEarlier(false);
    setNotice("");
    setPanel(null);
    requestAnimationFrame(() => appRef.current?.querySelector<HTMLElement>(".ws-conversation-title h1")?.focus({ preventScroll: true }));
  }

  function newSession(picture?: Picture) {
    const id = crypto.randomUUID();
    const now = Date.now();
    setWorkspace((current) => {
      const created = { id, title: picture?.title ?? "新會話", turns: [],
        profileId: current.lastProfileId === null ? undefined : current.lastProfileId ?? session.profileId,
        createdAt: now, updatedAt: now };
      const next = automaticMode({ ...sessionDraft(created, current.lastGeneration), references: picture ? [picture] : [] });
      return { ...current, sessions: [created, ...current.sessions], drafts: { ...current.drafts, [id]: next } };
    });
    setQuery("");
    switchSession(id);
  }

  function updateSession(change: Partial<Session>) {
    setWorkspace((current) => ({ ...current, sessions: current.sessions.map((item) =>
      item.id === session.id ? { ...item, ...change, updatedAt: Date.now() } : item) }));
    setPanel(null);
  }

  function duplicateSession() {
    const id = crypto.randomUUID();
    const now = Date.now();
    const imageIds = new Map(session.turns.map(({ image }) => [image.id, crypto.randomUUID()]));
    const duplicateImage = (image: Picture): Picture => ({ ...image, id: imageIds.get(image.id) ?? image.id,
      parentId: image.parentId ? imageIds.get(image.parentId) ?? image.parentId : undefined });
    const turns = session.turns.map((turn) => ({ ...turn, id: crypto.randomUUID(), image: duplicateImage(turn.image),
      request: turn.request ? { ...turn.request, references: turn.request.references.map((reference) =>
        imageIds.get(reference) ?? reference) } : undefined }));
    const mask = draft.mask ? duplicateImage(draft.mask) : undefined;
    if (mask && mask.parentId !== draft.mask?.parentId) mask.id = crypto.randomUUID();
    const resolutionByMode = { ...draft.resolutionByMode };
    const editSize = resolutionByMode.edit;
    if (editSize?.ratioReferenceId) {
      resolutionByMode.edit = { ...editSize, ratioReferenceId: imageIds.get(editSize.ratioReferenceId) ?? editSize.ratioReferenceId };
    }
    setWorkspace((current) => ({
      ...current, sessions: [{ id, title: `${session.title}（副本）`, turns, profileId: session.profileId,
        createdAt: now, updatedAt: now, generationDefaults: session.generationDefaults }, ...current.sessions],
      drafts: { ...current.drafts, [id]: automaticMode({ ...draft, references: draft.references.map(duplicateImage),
        resolutionByMode, mask }) },
    }));
    setQuery("");
    switchSession(id);
  }

  function deleteSession() {
    const activeJob = jobs.find(({ id }) => id === worker.current?.id);
    if (activeJob?.sessionId === session.id) worker.current?.controller.abort();
    setWorkspace((current) => removeSessions(current, new Set([session.id])));
    setSelectedIds([]);
    setShowEarlier(false);
    setNotice("");
    setPanel(null);
  }

  async function restoreWorkspace(restored: Workspace) {
    const safe = { ...interruptPendingJobs(restored), retentionDays: workspace.retentionDays,
      lastGeneration: restored.lastGeneration ?? workspace.lastGeneration,
      lastProfileId: restored.lastProfileId === undefined ? workspace.lastProfileId : restored.lastProfileId };
    await saveQueue.current;
    await writeWorkspace(safe, namespace);
    setWorkspace(safe);
    setStorageError(false);
    setSelectedIds([]);
    setShowEarlier(false);
    setQuery("");
    setPanel(null);
    setNotice("已還原本機備份。");
  }

  function attach(items: Picture[], prioritizeSource = false) {
    const id = session.id;
    if (prioritizeSource) maskUploads.current.delete(id);
    setWorkspace((current) => {
      const target = current.sessions.find((item) => item.id === id);
      if (!target) return current;
      const previous = current.drafts[id] ?? sessionDraft(target, current.lastGeneration);
      const ordered = prioritizeSource ? addReferences(items, previous.references) : addReferences(previous.references, items);
      return { ...current, drafts: { ...current.drafts, [id]: automaticMode({ ...previous, references: ordered }) } };
    });
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    const id = session.id;
    const rejected: AttachmentIssue[] = [];
    const accepted: File[] = [];
    for (const file of files) {
      const filename = file.name || "剪貼簿圖片";
      if (!/^(image\/(png|jpeg|webp))$/.test(file.type)) rejected.push({ filename, reason: "格式須為 PNG、JPG 或 WebP。" });
      else if (file.size > 12 * 1024 * 1024) rejected.push({ filename, reason: "超過 12 MB。" });
      else if (accepted.length >= applicationReferenceLimit) {
        rejected.push({ filename, reason: `每次最多匯入 ${applicationReferenceLimit} 張圖片。` });
      } else accepted.push(file);
    }
    const decoded = await Promise.allSettled(accepted.map(async (file) => ({
      id: crypto.randomUUID(), title: file.name || "剪貼簿圖片", source: file, ...await imagePreview(file),
    })));
    const imported: Picture[] = [];
    decoded.forEach((result, index) => {
      if (result.status === "fulfilled") imported.push(result.value);
      else rejected.push({ filename: accepted[index].name || "剪貼簿圖片", reason: "無法讀取圖片內容。" });
    });
    if (imported.length) setWorkspace((current) => {
      const assets = [...(current.assets ?? []), ...imported];
      const target = current.sessions.find((item) => item.id === id);
      if (!target) return { ...current, assets };
      const previous = current.drafts[id] ?? sessionDraft(target, current.lastGeneration);
      return { ...current, assets, drafts: { ...current.drafts, [id]: automaticMode({
        ...previous, references: addReferences(previous.references, imported),
      }) } };
    });
    setAttachmentUpload({ sessionId: id, rejected, imported: imported.map(({ id, title }) => ({ id, title })) });
  }

  async function addMask(file: File) {
    const source = draft.references[0];
    const sessionId = session.id;
    const operation = Symbol();
    maskUploads.current.set(sessionId, operation);
    setNotice("");
    const filename = file.name || "PNG 遮罩";
    const report = (reason: string) => setMaskUploadIssue({ sessionId, sourceId: source?.id, message: `${filename} · ${reason}` });
    if (!source || !supportsMask(profile) || file.type !== "image/png" || file.size > 4 * 1024 * 1024) {
      maskUploads.current.delete(sessionId);
      report("請選擇與來源圖相同尺寸且不超過 4 MB 的透明 PNG 遮罩。");
      return;
    }
    setMaskUploadIssue(undefined);
    try {
      const header = maskHeaderSize(new Uint8Array(await file.slice(0, 33).arrayBuffer()));
      if (maskUploads.current.get(sessionId) !== operation) return;
      if (!header) { report("遮罩須為含透明通道的 PNG。"); return; }
      if (header[0] !== source.width || header[1] !== source.height) {
        report("遮罩尺寸須與第一張來源圖一致。");
        return;
      }
      const size = await imageSize(file);
      if (maskUploads.current.get(sessionId) !== operation) return;
      if (size.width !== source.width || size.height !== source.height) {
        report("遮罩尺寸須與第一張來源圖一致。");
        return;
      }
      const mask: Picture = { id: crypto.randomUUID(), title: filename, source: file, ...size, parentId: source.id, kind: "mask" };
      setWorkspace((current) => {
        const currentDraft = current.drafts[sessionId];
        if (!currentDraft || currentDraft.references[0]?.id !== source.id) return current;
        return { ...current, assets: [...(current.assets ?? []), mask],
          drafts: { ...current.drafts, [sessionId]: { ...currentDraft, mask } } };
      });
    } catch {
      if (maskUploads.current.get(sessionId) === operation) report("遮罩無法讀取。");
    } finally {
      if (maskUploads.current.get(sessionId) === operation) maskUploads.current.delete(sessionId);
    }
  }

  function stopEnhance() {
    enhanceToken.current?.abort();
    enhanceToken.current = null;
    setEnhanceBusy(false);
  }

  function submissionProblem(prompt: string, enhance: Draft["enhance"]) {
    if (!online && profileRequired) return "Provider 需要網路連線。可在 Provider 設定切換至本機示範。";
    const problem = draftProblem({ ...draft, prompt }, profile);
    if (problem) return problem;
    if (profileRequired && !profile) {
      return "此會話的 Provider 或模型無法使用，請重新選擇。";
    }
    if (profile && !plugin?.sharedGateway && !profile.hasKey && (plugin || persistedKey(namespace, profile.id))) {
      return "請在 Provider 設定重新輸入 API Key。";
    }
    if (profile && !profile.model) {
      return "請在 Provider 設定選擇模型。";
    }
    if (enhance === "provider" && (!profile || profile.responsesModel)) {
      return "目前 Profile 未啟用 Provider Native 提示詞增強。";
    }
    return "";
  }

  function enqueue(prompt = draft.prompt.trim(), enhance = draft.enhance, enhancedPrompt?: string) {
    const problem = submissionProblem(prompt, enhance);
    if (problem) {
      if (panel === "enhance") setEnhanceStatus(problem);
      else setNotice(problem);
      return;
    }
    const id = session.id;
    stopEnhance();
    const now = Date.now();
    const job: GenerationJob = { id: crypto.randomUUID(), sessionId: id, sessionTitle: session.title,
      draft, profile, enhancedPrompt,
      request: { ...requestPreview(profile?.responsesModel ? { ...draft, batchSize: undefined } : draft, prompt, profile), enhance },
      status: "queued",
      createdAt: now, updatedAt: now, attempts: 0 };
    setWorkspace((current) => {
      const previous = current.drafts[id] ?? sessionDraft(session, current.lastGeneration);
      const cleared: Draft = { ...previous, prompt: previous.prompt === draft.prompt ? "" : previous.prompt,
        profileOverride: undefined };
      return { ...current, jobs: [...(current.jobs ?? []), job],
        lastGeneration: generationDefaults(previous),
        drafts: { ...current.drafts, [id]: cleared } };
    });
    setNotice("");
    setPanel(null);
  }

  function cancelJob(id: string) {
    const job = jobs.find((item) => item.id === id);
    if (isRunningBackgroundJob(job)) {
      if (cancellingId === id || progress?.id !== id || !("ticket" in progress.update)) return;
      setCancellingId(id);
      void cancelProviderJob(progress.update.ticket).catch((error: unknown) => {
        setWorkspace((current) => ({ ...current, jobs: current.jobs?.map((item) =>
          item.id === id && item.status === "running"
            ? { ...item, error: error instanceof Error ? error.message : "Provider 尚未確認取消。" } : item) }));
      }).finally(() => setCancellingId((value) => value === id ? undefined : value));
      return;
    }
    if (worker.current?.id === id) worker.current.controller.abort();
    setWorkspace((current) => ({ ...current, jobs: current.jobs?.map((job) =>
      job.id === id && (job.status === "queued" || job.status === "running")
        ? { ...job, status: "cancelled", error: undefined, updatedAt: Date.now() } : job) }));
  }

  function retryJob(id: string) {
    setWorkspace((current) => {
      const job = current.jobs?.find((item) => item.id === id);
      if (!job || (job.status !== "failed" && job.status !== "cancelled")) return current;
      return { ...current, jobs: [...(current.jobs ?? []).filter((item) => item.id !== id),
        { ...job, status: "queued", error: undefined, updatedAt: Date.now() }] };
    });
  }

  async function updateCandidate() {
    setEnhanceStatus("");
    setCandidate("");
    setSuggestedPrompt("");
    function acceptSuggestion(value: string) {
      setSuggestedPrompt(value);
      setCandidate(value);
    }
    const original = draft.prompt.trim();
    if (!profile) {
      const suggestion = `${original}\n\n強調主體與構圖，保留自然光影與清楚的畫面細節。`;
      acceptSuggestion(suggestion.length <= maxPromptLength ? suggestion : original);
      return;
    }
    if (!profile.enhanceModel) {
      setEnhanceStatus("請先設定提示詞增強的文字模型，或使用原文。");
      return;
    }
    const controller = new AbortController();
    enhanceToken.current?.abort();
    enhanceToken.current = controller;
    setEnhanceBusy(true);
    try {
      const result = await requestEnhancedPrompt(profile, original,
        AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]), namespace, plugin);
      if (enhanceToken.current === controller) acceptSuggestion(result.prompt);
    } catch (error) {
      if (enhanceToken.current !== controller) return;
      setEnhanceStatus(error instanceof Error ? error.message : "提示詞增強失敗。");
    } finally {
      if (enhanceToken.current === controller) { enhanceToken.current = null; setEnhanceBusy(false); }
    }
  }

  function submit() {
    if (draft.enhance !== "auto") { enqueue(); return; }
    const problem = submissionProblem(draft.prompt, draft.enhance);
    if (problem) { setNotice(problem); return; }
    setNotice("");
    setPanel("enhance");
    void updateCandidate();
  }

  const sessionList = <SessionSidebar sessions={workspace.sessions} id={session.id} query={query}
    onQuery={setQuery} onSelect={switchSession} onNew={() => newSession()} />;
  const history = <ImageHistoryPanel session={session} references={sessionReferences} view={historyView} onView={setHistoryView} selected={selected}
    onToggle={(picture) => setSelectedIds((ids) => ids.includes(picture.id) ? ids.filter((id) => id !== picture.id) : [...ids, picture.id])}
    onOpen={(picture) => setViewerId(picture.id)}
    onEdit={(picture) => { attach([picture], true); setPanel(null); focusComposer(); }}
    onAdd={() => { attach(selected); setSelectedIds([]); setPanel(null); focusComposer(); }}
    onCompare={() => setCompare({ ids: selected.map(({ id }) => id) })} />;
  function focusComposer() {
    requestAnimationFrame(() => appRef.current?.querySelector<HTMLElement>(".ws-composer textarea")?.focus({ preventScroll: true }));
  }
  function selectProfile(profileId?: string) {
    setWorkspace((current) => ({
      ...current, lastProfileId: profileId ?? null, sessions: current.sessions.map((item) => item.id === session.id ? { ...item, profileId } : item),
      drafts: { ...current.drafts, [session.id]: { ...(current.drafts[session.id] ?? sessionDraft(session, current.lastGeneration)), profileOverride: undefined } },
    }));
  }

  if (waitingForWorkspace) return <main className="ws-app">
    <div className="ws-empty-canvas" role="status">
      <h1>Image Studio</h1>
      <p>同一資料空間已在另一個分頁開啟。關閉該分頁後，此頁會自動接手。</p>
    </div>
  </main>;

  return (
    <div ref={appRef} className="ws-app" aria-busy={!ready} inert={!ready}
      data-session-drawer={sessionDrawerOpen} data-history-drawer={historyDrawerOpen}>
      <header className="ws-header">
        <IconButton icon="menu" label="開啟會話抽屜" className="ws-mobile-only" onClick={() => setPanel("sessions")} />
        <IconButton icon="menu" label="會話抽屜" className="ws-desktop-only" expanded={sessionDrawerOpen}
          controls="ws-session-drawer" onClick={() => setSessionDrawerOpen(!sessionDrawerOpen)} />
        <div className="ws-brand"><span className="ws-mark"><Icon name="auto_awesome" /></span><div className="ws-brand-name">
          <strong>Image Studio</strong><span className="ws-mobile-session" title={session.title}>{session.title}</span>
        </div></div>
        <span className="ws-breadcrumb"><Icon name="chevron_right" />{session.title}</span>
        <div className="ws-header-actions">
          <button type="button" className="ws-local" onClick={() => setPanel("provider")}
            title={plugin ? `${plugin.userId} · ${gatewayStatus}` : undefined}>
            <span />{plugin ? `LiteLLM · ${gatewayStatus}` : profile?.name ?? (profileRequired ? "Provider 無法使用" : "本機示範")}</button>
          <IconButton icon="gallery_thumbnail" label="開啟圖片抽屜" className="ws-mobile-only" onClick={() => setPanel("history")} />
          <IconButton icon="gallery_thumbnail" label="本會話圖片抽屜" className="ws-desktop-only" expanded={historyDrawerOpen}
            controls="ws-history-drawer" onClick={() => setHistoryDrawerOpen(!historyDrawerOpen)} />
          <IconButton icon="more_horiz" label="更多功能" className="ws-mobile-only" onClick={() => setPanel("menu")} />
        </div>
      </header>
      <AppLayout>
        <FunctionRail shortcutEnabled={shortcuts.enabled} providerLabel={providerLabel} onNew={() => newSession()}
          onGallery={() => setPanel("gallery")}
          onProvider={() => setPanel("provider")} onSettings={() => setPanel("settings")} />
        <aside id="ws-session-drawer" className="ws-sessions" aria-label="會話">
          <h2 id="session-heading" tabIndex={-1}>會話</h2>
          {sessionList}
        </aside>
        <ConversationPanel>
          <div className="ws-conversation-heading">
            <div className="ws-conversation-title"><h1 tabIndex={-1} title={session.title}>{session.title}</h1>
              <div className="ws-management-actions">
                <button type="button" className="ws-secondary ws-queue-open" aria-keyshortcuts={shortcuts.enabled ? "Alt+Shift+T" : undefined}
                  onClick={() => setPanel("queue")}>
                  <Icon name="history" />任務{pendingJobs.length ? ` (${pendingJobs.length})` : ""}
                </button>
                <IconButton icon="more_horiz" label="管理會話" onClick={() => setPanel("manage-session")} />
              </div>
            </div>
            <p><Icon name="imagesmode" />{plugin ? "LiteLLM Plugin" : "Standalone"} <span>·</span> {plugin && profile ? profile.model : "圖片工作台"}</p>
          </div>
          <div className="ws-messages" ref={conversationScroll.ref} onScroll={conversationScroll.onScroll}>
            {!last && <div className="ws-empty-canvas"><Icon name="image" /><h2>開始這個會話</h2>
              <p>輸入提示詞，或加入圖片開始編輯。</p></div>}
            {session.turns.length > 1 && <button type="button" className="ws-earlier" aria-expanded={showEarlier}
              onClick={() => {
                if (showEarlier) conversationScroll.followLatest();
                else conversationScroll.readEarlier();
                setShowEarlier(!showEarlier);
              }}><Icon name="history" />
              {showEarlier ? "收合較早的紀錄" : `較早的紀錄 (${session.turns.length - 1})`}</button>}
            {(showEarlier ? session.turns : visibleTurn ? [visibleTurn] : []).map((turn) => {
              const version = session.turns.indexOf(turn) + 1;
              return <article className="ws-turn" key={turn.id}>
                <div className="ws-user-prompt"><small>提示詞</small><p>{turn.prompt}</p></div>
                <figure className="ws-result">
                  <button type="button" className="ws-result-image" aria-label={`檢視 V${version} ${turn.image.title}`}
                    onClick={() => setViewerId(turn.image.id)}>
                    <PictureImage source={turn.image.source} alt={turn.image.title} />
                    <span className="ws-expand"><Icon name="open_in_full" /></span>
                  </button>
                  <figcaption>
                    <div><strong>{turn.image.title}</strong><small>V{version} · {turn.image.width} × {turn.image.height}
                      {turn.provider ? ` · ${turn.provider.model}` : turn.request ? ` · Seed ${turn.request.seed}` : " · 範例照片"}</small></div>
                    {turn.provider && <button type="button" className="ws-secondary"
                      onClick={() => setDetails(turn.provider)}>請求資訊</button>}
                    <button type="button" className="ws-secondary" onClick={() => attach([turn.image], true)}>
                      <Icon name="add" />以此圖編輯
                    </button>
                  </figcaption>
                </figure>
              </article>;
            })}
            {visibleJob && <p role="status" className={`ws-job ws-status-line ws-${jobTones[visibleJob.status]}`}>
              <StatusMark tone={jobTones[visibleJob.status]} />{jobStatusLabel(visibleJob, positions)}
              {visibleJob.status === "running" && progress?.id === visibleJob.id && <JobProgress progress={progress.update} />}
              {(visibleJob.status === "running" || visibleJob.status === "queued") && <CancelJobButton job={visibleJob}
                cancelling={cancellingId === visibleJob.id} progress={progress?.id === visibleJob.id ? progress.update : undefined}
                onCancel={cancelJob} />}
              {visibleJob.error && ` · ${visibleJob.error}`}</p>}
          </div>
          {conversationScroll.hasNewResult && <div className="ws-jump-latest">
            <button type="button" className="ws-secondary" onClick={conversationScroll.followLatest}>
              <Icon name="arrow_downward" />跳到最新結果
            </button>
          </div>}
          {(notice || storageError || !online) && <p className="ws-notice" role="status">{notice
            || (storageError ? "瀏覽器無法寫入本機資料庫，變更僅保留於本次頁面。"
              : plugin ? "離線中，LiteLLM 需要網路連線。" : "離線中，可以使用本機資料與示範。")}</p>}
          <PromptComposer draft={draft} sourceVersion={sourceVersion} followLatestImage={session.followLatestImage === true}
            onToggleFollowLatestImage={toggleFollowLatestImage} attachmentIssues={attachmentIssues}
            maskUploadIssue={maskUploadIssue?.sessionId === session.id && maskUploadIssue.sourceId === draft.references[0]?.id
              ? maskUploadIssue.message : undefined}
            dismissAttachmentIssues={() => setAttachmentUpload(undefined)}
            update={(change) => {
              if (change.references && attachmentUpload?.sessionId === session.id) setAttachmentUpload(undefined);
              if (change.references || Object.hasOwn(change, "mask")) {
                maskUploads.current.delete(session.id);
                if (maskUploadIssue?.sessionId === session.id) setMaskUploadIssue(undefined);
              }
              updateDraft(change);
            }}
            onFiles={(files) => void addFiles(files)} onMask={(file) => void addMask(file)}
            onPreview={(picture) => setViewerId(picture.id)}
            onHistoryDrop={(id) => {
              const picture = sessionPictures.get(id);
              if (picture) attach([picture], true);
            }}
            connected={profileRequired} profile={profile} availableProfiles={providers.profiles} standalone={!plugin} onSubmit={submit}
            onExtra={() => setPanel("extra")} onProvider={() => setPanel("provider")} />
        </ConversationPanel>
        <aside id="ws-history-drawer" className="ws-history" aria-label="本會話圖片">
          <div className="ws-side-heading"><h2>本會話圖片</h2><span>{sessionImageCount.toString().padStart(2, "0")}</span></div>
          {history}
        </aside>
      </AppLayout>
      {(panel === "sessions" || panel === "history") && <MobileDrawer panel={panel} onClose={() => setPanel(null)}>
        {panel === "sessions" ? sessionList : <><p className="ws-muted">{sessionImageCount} 張圖片</p>{history}</>}
      </MobileDrawer>}
      {panel === "menu" && <PanelDialog title="工作台功能" onClose={() => setPanel(null)}>
        <div className="ws-dialog-content ws-menu">
          <p className="ws-muted">{plugin ? `LiteLLM · ${plugin.userId}` : "Standalone"}</p>
          <button type="button" className="ws-secondary" onClick={() => newSession()}>新建會話</button>
          <button type="button" className="ws-secondary" onClick={() => setPanel("gallery")}>圖片庫</button>
          <button type="button" className="ws-secondary" onClick={() => setPanel("provider")}>{providerLabel}</button>
          <button type="button" className="ws-secondary" onClick={() => setPanel("settings")}>設定</button>
        </div>
      </PanelDialog>}
      {panel === "gallery" && <PanelDialog title="圖片庫" onClose={() => setPanel(null)}>
        <div className="ws-dialog-content ws-gallery">
          {libraryPictures.map((picture) =>
            <button type="button" key={picture.id} onClick={() => setViewerId(picture.id)}>
              <PictureImage source={picture.thumbnail ?? picture.source} alt="" /><span>{picture.title}</span>
            </button>)}
          {!libraryPictures.length && <p className="ws-empty">圖片庫目前是空的。</p>}
        </div>
      </PanelDialog>}
      {panel === "provider" && <ProviderSettings data={providers} selectedId={session.profileId ?? (plugin ? profile?.id : undefined)}
        onChange={setProviders} onSelect={selectProfile} online={online} onClose={() => setPanel(null)} namespace={namespace}
        gateway={plugin ? { baseUrl: sharedBase ?? plugin.gatewayBaseUrl, userId: plugin.userId, plugin } : undefined} />}
      {panel === "settings" && <PanelDialog title="設定" onClose={() => setPanel(null)}>
        <div className="ws-dialog-content">
          <AppearanceSettings />
          <form className="ws-inline-form" onSubmit={(event) => {
            event.preventDefault();
            const value = Number(new FormData(event.currentTarget).get("retentionDays"));
            if (!Number.isSafeInteger(value) || value < 0) return;
            setWorkspace((current) => pruneExpiredSessions({ ...current, retentionDays: value }));
            setPanel(null);
          }}>
            <label className="ws-field">會話保留天數<input name="retentionDays" type="number" min="0" step="1"
              defaultValue={retentionDays} required /><small>從最後一則對話起算，0 天停用自動清理。</small></label>
            <button type="submit" className="ws-secondary">套用</button>
          </form>
          <div className="ws-management-actions">
            <button type="button" className="ws-secondary" onClick={() => setPanel("shortcuts")}>鍵盤快捷鍵</button>
            <button type="button" className="ws-secondary" disabled={pendingJobs.length > 0}
              onClick={() => setPanel("manage-data")}>本機資料管理</button>
            {canInstall && <button type="button" className="ws-secondary" onClick={() => void install()}>安裝 Image Studio</button>}
          </div>
          {pendingJobs.length > 0 && <p className="ws-muted">生成任務結束後可管理本機資料。</p>}
        </div>
      </PanelDialog>}
      {panel === "shortcuts" && <ShortcutHelp enabled={shortcuts.enabled} onChange={shortcuts.update} onClose={() => setPanel("settings")} />}
      {panel === "queue" && <QueuePanel jobs={jobs} positions={positions} progress={progress} cancellingId={cancellingId}
        onClose={() => setPanel(null)} onSession={switchSession}
        onCancel={cancelJob} onRetry={retryJob} onRemove={(id) => setWorkspace((current) => ({
          ...current, jobs: current.jobs?.filter((job) => job.id !== id || job.status === "queued" || job.status === "running"),
        }))} />}
      {panel === "manage-session" && <ManageSession session={session} onClose={() => setPanel(null)}
        onRename={(title) => updateSession({ title })} onPin={() => updateSession({ pinned: !session.pinned })}
        onArchive={() => updateSession({ archived: !session.archived })} onDuplicate={duplicateSession}
        onDelete={deleteSession} onExport={() => exportWorkspace(workspace, session)}
        onSaveDefaults={() => { updateSession({ generationDefaults: generationDefaults(draft) }); setNotice("已儲存會話預設參數。"); }}
        onRestoreDefaults={() => {
          setWorkspace((current) => ({ ...current, drafts: {
            ...current.drafts, [session.id]: restoreGenerationDefaults(draft, session),
          } }));
          setPanel(null);
          setNotice("已套用會話預設參數。");
        }} />}
      {panel === "manage-data" && <ManageData workspace={workspace} onRestore={restoreWorkspace}
        onCleanup={() => setWorkspace((current) => ({ ...current, assets: cleanUnusedAssets(current) }))}
        onClose={() => setPanel("settings")} />}
      {panel === "extra" && <ExtraBodyPanel draft={draft} profile={profile}
        namespace={namespace} onClose={() => setPanel(null)}
        onApply={(extra, extraOverrides) => { updateDraft({ extra, extraOverrides }); setPanel(null); }} />}
      {panel === "enhance" && <PanelDialog title="審閱增強提示詞" onClose={() => { stopEnhance(); setPanel(null); }}>
        <div className="ws-dialog-content">
          <p className="ws-muted">原始提示詞</p><p className="ws-enhance-original">{draft.prompt}</p>
          <label className="ws-field">{profile ? "可編輯的增強候選" : "可編輯的示範候選"}<textarea rows={5} value={candidate}
            disabled={enhanceBusy}
            onChange={(event) => setCandidate(event.target.value)} /></label>
          {(enhanceBusy || enhanceStatus) && <p role="status">{enhanceBusy ? "正在取得增強候選…" : enhanceStatus}</p>}
          <div className="ws-management-actions">
            <button type="button" className="ws-secondary" onClick={() => enqueue(draft.prompt.trim(), "off", suggestedPrompt || undefined)}>使用原文</button>
            <button type="button" className="ws-secondary" disabled={enhanceBusy || !candidate.trim()}
              onClick={() => void navigator.clipboard.writeText(candidate).then(
                () => setEnhanceStatus("已複製增強候選。"), () => setEnhanceStatus("無法寫入剪貼簿。"),
              )}>複製</button>
            {enhanceStatus && !candidate.trim() && <button type="button" className="ws-secondary" disabled={enhanceBusy}
              onClick={() => void updateCandidate()}>重新增強</button>}
            <button type="button" className="ws-primary" disabled={enhanceBusy || !candidate.trim()}
              onClick={() => enqueue(candidate.trim(), "auto", suggestedPrompt || undefined)}>採用並繼續</button>
          </div>
        </div>
      </PanelDialog>}
      {viewer && <Viewer picture={viewer} turn={viewerInfo?.turn} version={viewerInfo?.label} onClose={() => setViewerId(null)}
        onCompare={viewerParent ? () => setCompare({ ids: [viewerParent.id, viewer.id], sourcePair: true }) : undefined}
        onEdit={() => { attach([viewer], true); setViewerId(null); setPanel(null); focusComposer(); }}
        onNewSession={() => { newSession(viewer); setViewerId(null); focusComposer(); }} />}
      {compare && comparisons && comparisons.length >= 2 && <ImageComparison versions={comparisons} startSplit={compare.sourcePair}
        onClose={() => setCompare(undefined)} />}
      {details && <PanelDialog title="Provider 請求資訊" onClose={() => setDetails(undefined)}>
        <div className="ws-dialog-content">
          <p>{details.name} · {details.model}</p>
          <h3>Request</h3><pre className="ws-json-preview">{JSON.stringify(details.sent, null, 2)}</pre>
          <h3>Response</h3><pre className="ws-json-preview">{JSON.stringify(details.response, null, 2)}</pre>
          {details.revisedPrompt && <><h3>Provider 改寫的提示詞</h3><p>{details.revisedPrompt}</p></>}
        </div>
      </PanelDialog>}
    </div>
  );
}
