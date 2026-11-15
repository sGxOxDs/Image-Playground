import type { GenerationJob, JobStatus } from "./model";
import { isRunningBackgroundJob, type GenerationProgress } from "./generation-queue";
import { PanelDialog, StatusMark } from "./ui";

const jobLabels: Record<JobStatus, string> = {
  queued: "排隊中", running: "處理中", completed: "完成", failed: "失敗", cancelled: "已取消",
};
export const jobTones = { queued: "pending", running: "pending", completed: "success", failed: "error", cancelled: "warning" } as const;

export function jobStatusLabel(job: GenerationJob, positions: ReadonlyMap<string, number>) {
  const position = positions.get(job.id);
  return position === undefined ? jobLabels[job.status] : `排隊中 · 第 ${position} 位`;
}

export function JobProgress({ progress }: { progress: GenerationProgress }) {
  if ("previews" in progress) return <span>已收到 {progress.previews} 個中間預覽</span>;
  if ("ticket" in progress) return <span>{progress.status === "queued" ? "Provider 排隊中" : "Provider 處理中"}</span>;
  return <label className="ws-job-progress">已產生 {progress.rendered}／{progress.total} 張
    <progress max={progress.total} value={progress.rendered} />
  </label>;
}

export function CancelJobButton({ job, cancelling, progress, onCancel }: {
  job: GenerationJob; cancelling: boolean; progress?: GenerationProgress; onCancel: (id: string) => void;
}) {
  const remote = isRunningBackgroundJob(job);
  const waiting = remote && !(progress && "ticket" in progress);
  return <button type="button" className="ws-secondary" disabled={Boolean(cancelling || waiting)} onClick={() => onCancel(job.id)}>
    {cancelling ? "等待取消確認…" : remote ? "取消上游任務" : job.status === "running" && job.profile ? "中止接收" : "取消任務"}
  </button>;
}

export function QueuePanel({ jobs, positions, progress, cancellingId, onClose, onCancel, onRetry, onRemove, onSession }: {
  jobs: GenerationJob[];
  positions: ReadonlyMap<string, number>;
  progress?: { id: string; update: GenerationProgress };
  cancellingId?: string;
  onClose: () => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onSession: (id: string) => void;
}) {
  const ordered = [
    ...jobs.filter(({ status }) => status === "running"),
    ...jobs.filter(({ status }) => status === "queued"),
    ...jobs.filter(({ status }) => status !== "queued" && status !== "running").reverse(),
  ];
  return <PanelDialog title="生成任務" onClose={onClose}>
    <ol className="ws-dialog-content ws-queue">
      {!jobs.length && <li className="ws-muted">尚無生成任務。</li>}
      {ordered.map((job) => <li key={job.id} data-job-status={job.status}>
        <div className="ws-job-heading">
          <strong className={`ws-status-line ws-${jobTones[job.status]}`}>
            <StatusMark tone={jobTones[job.status]} />{jobStatusLabel(job, positions)}
          </strong>
          <button type="button" className="ws-job-session" onClick={() => onSession(job.sessionId)}>{job.sessionTitle}</button>
        </div>
        <p className="ws-job-prompt">{job.request.prompt}</p>
        <small className="ws-muted">{job.profile?.model ?? "本機示範"} · {job.request.mode === "edit" ? "編輯" : "生成"}
          {job.attempts > 1 && ` · 第 ${job.attempts} 次`}
          {job.results?.length ? ` · ${job.results.length} 張圖片` : ""}</small>
        {job.error && <p className="ws-error">{job.error}</p>}
        {job.status === "running" && progress?.id === job.id && <p role="status"><JobProgress progress={progress.update} /></p>}
        <div className="ws-management-actions">
          {job.status === "running" || job.status === "queued" ?
            <CancelJobButton job={job} cancelling={cancellingId === job.id} progress={progress?.id === job.id ? progress.update : undefined}
              onCancel={onCancel} /> : <>
              {(job.status === "failed" || job.status === "cancelled") &&
                <button type="button" className="ws-secondary" onClick={() => onRetry(job.id)}>以原設定重試</button>}
              <button type="button" className="ws-secondary" onClick={() => onRemove(job.id)}>移除任務紀錄</button>
            </>}
        </div>
      </li>)}
    </ol>
  </PanelDialog>;
}
