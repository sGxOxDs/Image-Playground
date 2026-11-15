import { imagePreview, renderDemo, type GenerationJob, type Turn, type Workspace } from "./model";
import { sendImage } from "./provider-client";

export type GenerationProgress = { previews: number } | { rendered: number; total: number }
  | { ticket: string; status: "queued" | "in_progress" };

export function isRunningBackgroundJob(job?: GenerationJob) {
  return job?.status === "running" && Boolean(job.profile?.responsesModel && job.profile.imageCapabilities?.responsesBackground);
}

export function interruptPendingJobs(workspace: Workspace): Workspace {
  const now = Date.now();
  return { ...workspace, jobs: workspace.jobs?.map((job) =>
    job.status === "queued" || job.status === "running" ? { ...job, status: "failed", updatedAt: now,
      error: "工作台曾關閉或重新載入。需要時可從原本的設定重試。" } : job) };
}

export async function executeJob(job: GenerationJob, signal: AbortSignal, namespace: string,
  onProgress?: (progress: GenerationProgress) => void): Promise<Turn[]> {
  const { id, draft, profile, request } = job;
  const result = profile ? await sendImage(draft, request, profile, signal, false, namespace,
    (event) => onProgress?.(event.type === "partial" ? { previews: event.count }
      : { ticket: event.ticket, status: event.status })) : undefined;
  const demo = [];
  if (!profile) {
    const count = request.extraBody.n ?? 1;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 4) {
      throw new Error("每次可生成 1 至 4 張圖片。");
    }
    for (let index = 0; index < count; index++) {
      signal.throwIfAborted();
      const imageRequest = { ...request, seed: (request.seed + index) >>> 0 };
      demo.push({ blob: await renderDemo(draft, imageRequest), revisedPrompt: undefined, imageSeed: undefined, imageRequest });
      onProgress?.({ rendered: demo.length, total: count });
    }
  }
  const outputs = result
    ? result.images.map(({ blob, revisedPrompt, seed }) =>
      ({ blob, revisedPrompt, imageSeed: seed, imageRequest: request }))
    : demo;
  signal.throwIfAborted();
  const createdAt = Date.now();
  return Promise.all(outputs.map(async ({ blob, revisedPrompt, imageSeed, imageRequest }, index) => {
    const preview = await imagePreview(blob);
    return {
      id: `${id}-turn-${index}`, createdAt, prompt: request.prompt, request: imageRequest, originalPrompt: draft.prompt.trim(),
      enhancedPrompt: job.enhancedPrompt,
      image: { id: `${id}-image-${index}`, title: profile ? "生成結果" : "本機示範結果",
        source: blob, ...preview, parentId: draft.mode === "edit" ? draft.references[0]?.id : undefined,
        continuation: result?.continuation },
      provider: profile && result ? { name: profile.name, model: profile.model, sent: result.preview,
        response: result.response, revisedPrompt, imageSeed } : undefined,
    };
  }));
}
