import { useRef, type ReactNode } from "react";
import { PanelDialog } from "../workspace/ui";

export function MobileDrawer({ panel, onClose, children }: {
  panel: "sessions" | "history"; onClose: () => void; children: ReactNode;
}) {
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  return (
    <PanelDialog title={panel === "sessions" ? "會話" : "本會話圖片"}
      className={`ws-drawer ws-drawer-${panel}`} onClose={onClose}>
      <div className="ws-dialog-content"
        onTouchStart={(event) => {
          const touch = event.touches[0];
          swipeStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchCancel={() => { swipeStart.current = null; }}
        onTouchEnd={(event) => {
          const start = swipeStart.current;
          swipeStart.current = null;
          if (!start || event.touches.length) return;
          const end = event.changedTouches[0];
          const towardEdge = (end.clientX - start.x) * (panel === "sessions" ? -1 : 1);
          if (towardEdge >= 64 && towardEdge > 1.5 * Math.abs(end.clientY - start.y)) onClose();
        }}>
        {children}
      </div>
    </PanelDialog>
  );
}
