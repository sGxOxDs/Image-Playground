import type { ReactNode } from "react";
import { IconButton } from "../workspace/ui";

export function AppLayout({ children }: { children: ReactNode }) {
  return <div className="ws-layout">{children}</div>;
}

export function FunctionRail({ shortcutEnabled, providerLabel, onNew, onGallery, onProvider, onSettings }: {
  shortcutEnabled: boolean; providerLabel: string; onNew: () => void; onGallery: () => void;
  onProvider: () => void; onSettings: () => void;
}) {
  return (
    <nav className="ws-rail" aria-label="工作台功能">
      <IconButton icon="add" label="新建會話" shortcut={shortcutEnabled ? "Alt+Shift+N" : undefined}
        onClick={onNew} className="ws-rail-add" />
      <IconButton icon="photo_library" label="開啟圖片庫" tourTarget="gallery" onClick={onGallery} />
      <IconButton icon="tune" label={providerLabel} onClick={onProvider} className="ws-rail-provider" />
      <IconButton icon="settings" label="設定" tourTarget="settings" onClick={onSettings} />
    </nav>
  );
}

export function ConversationPanel({ children }: { children: ReactNode }) {
  return <main className="ws-conversation">{children}</main>;
}
