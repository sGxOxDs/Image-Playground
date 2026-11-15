import { useRef, useState } from "react";
import { cleanUnusedAssets, exportWorkspace, importWorkspace } from "./backup";
import type { Session, Workspace } from "./model";
import { PanelDialog } from "./ui";

export function ManageSession({ session, onClose, onRename, onPin, onArchive, onDuplicate, onDelete, onExport,
  onSaveDefaults, onRestoreDefaults }: {
  session: Session;
  onClose: () => void;
  onRename: (title: string) => void;
  onPin: () => void;
  onArchive: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => Promise<void>;
  onSaveDefaults: () => void;
  onRestoreDefaults: () => void;
}) {
  const [title, setTitle] = useState(session.title);
  const [confirm, setConfirm] = useState(false);
  const [status, setStatus] = useState("");
  return <PanelDialog title="管理會話" onClose={onClose}>
    <div className="ws-dialog-content">
      <form className="ws-inline-form" onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) onRename(title.trim());
      }}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="會話名稱" maxLength={80} />
        <button type="submit" className="ws-primary" disabled={!title.trim()}>重新命名</button>
      </form>
      <div className="ws-management-actions">
        <button type="button" className="ws-secondary" onClick={onPin}>{session.pinned ? "取消置頂" : "置頂"}</button>
        <button type="button" className="ws-secondary" onClick={onArchive}>{session.archived ? "取消封存" : "封存"}</button>
        <button type="button" className="ws-secondary" onClick={onDuplicate}>複製會話</button>
        <button type="button" className="ws-secondary"
          onClick={() => void onExport().catch(() => setStatus("無法匯出會話。"))}>匯出會話</button>
        <button type="button" className="ws-secondary" onClick={() => setConfirm(true)}>刪除會話</button>
      </div>
      <h3>生成預設</h3>
      <div className="ws-management-actions">
        <button type="button" className="ws-secondary" onClick={onSaveDefaults}>儲存目前參數為預設</button>
        <button type="button" className="ws-secondary" onClick={onRestoreDefaults}>還原預設參數</button>
      </div>
      {confirm && <div className="ws-management-actions">
        <p>刪除「{session.title}」及其會話紀錄？</p>
        <button type="button" className="ws-secondary" onClick={() => setConfirm(false)}>保留</button>
        <button type="button" className="ws-primary" onClick={onDelete}>確認刪除</button>
      </div>}
      {status && <p role="status">{status}</p>}
    </div>
  </PanelDialog>;
}

export function ManageData({ workspace, onRestore, onCleanup, onClose }: {
  workspace: Workspace;
  onRestore: (restored: Workspace) => Promise<void>;
  onCleanup: () => void;
  onClose: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const orphanCount = (workspace.assets?.length ?? 0) - cleanUnusedAssets(workspace).length;

  async function prepare(file: File) {
    setBusy(true);
    setPending(null);
    setStatus("");
    try { setPending(await importWorkspace(file)); }
    catch { setStatus("無法讀取備份。請選擇 Image Studio 匯出的有效 JSON。"); }
    finally { setBusy(false); }
  }

  async function restore() {
    if (!pending) return;
    setBusy(true);
    try { await onRestore(pending); }
    catch { setStatus("還原失敗，現有資料已保留。"); }
    finally { setBusy(false); }
  }

  return <PanelDialog title="本機資料管理" onClose={() => { if (!busy) onClose(); }}>
    <div className="ws-dialog-content">
      <div className="ws-management-actions">
        <button type="button" className="ws-secondary" disabled={busy}
          onClick={() => void exportWorkspace(workspace).catch(() => setStatus("無法匯出備份。"))}>下載完整備份</button>
        <button type="button" className="ws-secondary" disabled={busy} onClick={() => fileInput.current?.click()}>選擇備份檔</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void prepare(file);
          event.target.value = "";
        }} />
      </div>
      {pending && <div className="ws-management-actions">
        <p>備份包含 {pending.sessions.length} 個會話。還原會取代目前資料空間。</p>
        <button type="button" className="ws-secondary" disabled={busy} onClick={() => setPending(null)}>取消</button>
        <button type="button" className="ws-primary" disabled={busy} onClick={() => void restore()}>確認還原</button>
      </div>}
      <button type="button" className="ws-secondary" disabled={busy || !orphanCount} onClick={() => {
        onCleanup();
        setStatus(`已清理 ${orphanCount} 張未使用的圖片。`);
      }}>清理未使用圖片（{orphanCount}）</button>
      {status && <p role="status">{status}</p>}
    </div>
  </PanelDialog>;
}
