import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import { PanelDialog } from "./ui";

const preference = "image-studio-workspace-shortcuts";
const actions = {
  n: "新建會話",
  p: "聚焦提示詞",
  t: "開啟生成任務",
} as const;

export function useWorkspaceShortcuts(app: RefObject<HTMLElement | null>, ready: boolean, handlers: Record<keyof typeof actions, () => void>) {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    try { setEnabled(localStorage.getItem(preference) !== "off"); } catch { /* Retain the current tab's preference. */ }
    function sync(event: StorageEvent) {
      if (event.key === preference || event.key === null) setEnabled(event.newValue !== "off");
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const listen = useEffectEvent((event: KeyboardEvent) => {
    if (!enabled || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat
      || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
    if (app.current?.querySelector("dialog[open], [popover]:popover-open")) return;
    const key = event.key.toLowerCase();
    if (!Object.hasOwn(actions, key)) return;
    event.preventDefault();
    handlers[key as keyof typeof actions]();
  });
  useEffect(() => {
    if (!ready) return;
    function onKeyDown(event: KeyboardEvent) { listen(event); }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ready]);

  function update(value: boolean) {
    setEnabled(value);
    try { localStorage.setItem(preference, value ? "on" : "off"); } catch { /* The current tab still honors the choice. */ }
  }
  return { enabled, update };
}

export function ShortcutHelp({ enabled, onChange, onClose }: {
  enabled: boolean; onChange: (enabled: boolean) => void; onClose: () => void;
}) {
  return <PanelDialog title="鍵盤快捷鍵" onClose={onClose}>
    <div className="ws-dialog-content">
      <label className="ws-radio"><input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} />
        啟用工作台快捷鍵
      </label>
      <dl className="ws-shortcuts">
        {Object.entries(actions).map(([key, label]) => <div key={key}>
          <dt>{label}</dt><dd><kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>{key.toUpperCase()}</kbd></dd>
        </div>)}
        <div><dt>桌面提示詞送出</dt><dd><kbd>Enter</kbd></dd></div>
        <div><dt>桌面提示詞換行</dt><dd><kbd>Shift</kbd> + <kbd>Enter</kbd></dd></div>
        <div><dt>關閉最上層面板</dt><dd><kbd>Esc</kbd></dd></div>
      </dl>
    </div>
  </PanelDialog>;
}
