import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { resolveImageSource, type ImageSource } from "./model";

export function Icon({ name }: { name: string }) {
  return <span className="material-symbol" aria-hidden="true">{name}</span>;
}

export function StatusMark({ tone }: { tone: "success" | "warning" | "error" | "pending" }) {
  return <span aria-hidden="true" className={`ws-status-mark ws-${tone}`}>{
    { success: "✓", warning: "!", error: "×", pending: "…" }[tone]
  }</span>;
}

export function IconButton({ icon, label, onClick, pressed, expanded, controls, disabled, shortcut, tourTarget, className = "" }: {
  icon: string; label: string; onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  pressed?: boolean; expanded?: boolean; controls?: string; disabled?: boolean; shortcut?: string; className?: string;
  tourTarget?: string;
}) {
  return (
    <button type="button" className={`ws-icon-button ${className}`} title={label} aria-label={label}
      aria-pressed={pressed} aria-expanded={expanded} aria-controls={controls}
      aria-keyshortcuts={shortcut} data-tour-target={tourTarget} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

export function useImageUrl(source: ImageSource) {
  const [objectUrl, setObjectUrl] = useState("");
  useEffect(() => {
    if (typeof source === "string") return;
    const url = URL.createObjectURL(source);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);
  return typeof source === "string" ? resolveImageSource(source) : objectUrl;
}

export function PictureImage({ source, alt, className }: { source: ImageSource; alt: string; className?: string }) {
  const url = useImageUrl(source);
  const [failed, setFailed] = useState("");
  if (!url) return null;
  if (failed === url) return <span className="ws-image-error" role="status">圖片無法載入</span>;
  return <img src={url} alt={alt} className={className} draggable={false} onError={() => setFailed(url)} />;
}

const openDialogs: HTMLDialogElement[] = [];

export function PanelDialog({ title, onClose, className = "", children }: {
  title: string; onClose: () => void; className?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = document.activeElement;
    const parentDialog = opener?.closest("dialog[open]");
    dialog.showModal();
    openDialogs.push(dialog);
    return () => {
      openDialogs.splice(openDialogs.indexOf(dialog), 1);
      dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      } else if (parentDialog?.matches("dialog[open]")) {
        parentDialog.querySelector<HTMLButtonElement>(".ws-dialog-heading button")?.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <dialog ref={ref} aria-label={title} className={`ws-dialog ${className}`}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
        if (openDialogs.at(-1) !== event.currentTarget) return;
        event.preventDefault();
        if (!event.repeat) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        const dialog = event.currentTarget;
        if (openDialogs.at(-1) !== dialog) return;
        // Browsers may send the same close request to multiple native dialogs.
        requestAnimationFrame(() => { if (openDialogs.at(-1) === dialog) onClose(); });
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX >= bounds.right
            || event.clientY < bounds.top || event.clientY >= bounds.bottom) onClose();
      }}>
      <div className="ws-dialog-frame">
        <div className="ws-dialog-heading">
          <h2>{title}</h2>
          <IconButton icon="close" label="關閉" onClick={onClose} />
        </div>
        {children}
      </div>
    </dialog>
  );
}
