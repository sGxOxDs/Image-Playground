import { useLayoutEffect, useRef, type RefObject } from "react";

const steps = [
  { target: "sessions", title: "會話", description: "開啟會話列表，搜尋或切換工作。桌面從左側的加號新增會話，手機則從「更多功能」新增。" },
  { target: "composer", title: "提示詞與生成參數", description: "在這裡描述想生成的圖片。加入參考圖即可開始編輯，也能在下方調整尺寸、Seed 和進階參數。" },
  { target: "history", title: "本會話圖片", description: "開啟圖片抽屜，瀏覽這個會話的結果與參考圖。你可以比較版本，或取用舊圖繼續編輯。" },
  { target: "queue", title: "生成任務", description: "查看排隊、處理中與已完成的任務，也能在這裡取消或重試。" },
  { target: "provider", title: "Provider", pluginTitle: "LiteLLM Gateway", description: "在這裡設定 Provider 端點、API Key 與圖片模型。獨立版也可先試用本機示範。",
    pluginDescription: "在這裡設定可用的圖片模型。若工作台需要個人憑證，請在此輸入 LiteLLM Virtual Key。" },
  { target: "gallery", title: "圖片庫", description: "在圖片庫瀏覽目前工作區的圖片，並取用其他會話的圖片。手機可從「更多功能」開啟。" },
  { target: "settings", title: "設定", description: "可調整外觀及會話保留期限、備份工作區或重播導覽。手機可從「更多功能」開啟。" },
] as const;

export function WorkspaceTour({ app, plugin, stepIndex, finishing, onStep, onFinish }: {
  app: RefObject<HTMLDivElement | null>;
  plugin: boolean;
  stepIndex: number;
  finishing: boolean;
  onStep: (index: number) => void;
  onFinish: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const step = steps[stepIndex];
  const last = stepIndex === steps.length - 1;

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const opener = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      const target = opener instanceof HTMLElement && opener !== document.body && opener.isConnected
        ? opener : app.current?.querySelector<HTMLElement>(".ws-conversation-title h1");
      target?.focus({ preventScroll: true });
    };
  }, [app]);

  useLayoutEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    const dialog = dialogRef.current!;
    const card = cardRef.current!;
    const spotlight = spotlightRef.current!;
    const anchors = [...(app.current?.querySelectorAll<HTMLElement>(`[data-tour-target~="${step.target}"]`) ?? [])];

    function position() {
      const frame = dialog.getBoundingClientRect();
      const anchor = anchors.find((element) => element.getClientRects().length && getComputedStyle(element).visibility === "visible");
      const rect = anchor?.getBoundingClientRect();
      const margin = 12;
      const gap = 12;
      const { offsetWidth: width, offsetHeight: height } = card;
      const fit = (value: number, limit: number) => Math.max(margin, Math.min(value, limit - margin));
      let left = (frame.width - width) / 2;
      let top = (frame.height - height) / 2;
      const padding = 4;
      const x = Math.max(0, (rect?.left ?? 0) - frame.left - padding);
      const y = Math.max(0, (rect?.top ?? 0) - frame.top - padding);
      const right = Math.min(frame.width, (rect?.right ?? 0) - frame.left + padding);
      const bottom = Math.min(frame.height, (rect?.bottom ?? 0) - frame.top + padding);
      const visible = !!rect && right > x && bottom > y;
      spotlight.hidden = !visible;
      dialog.toggleAttribute("data-spotlight", visible);
      if (visible) {
        Object.assign(spotlight.style, { left: `${x}px`, top: `${y}px`, width: `${right - x}px`, height: `${bottom - y}px` });
        left = (x + right - width) / 2;
        if (bottom + gap + height + margin <= frame.height) top = bottom + gap;
        else if (y - gap - height >= margin) top = y - gap - height;
        else if (right + gap + width + margin <= frame.width) left = right + gap;
        else if (x - gap - width >= margin) left = x - gap - width;
        else top = frame.height - bottom > y ? bottom + gap : y - gap - height;
      }
      card.style.left = `${fit(left, frame.width - width)}px`;
      card.style.top = `${fit(top, frame.height - height)}px`;
    }

    const observer = new ResizeObserver(position);
    for (const element of [dialog, card, ...anchors]) observer.observe(element);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    position();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [app, step]);

  const title = plugin && "pluginTitle" in step ? step.pluginTitle : step.title;
  const description = plugin && "pluginDescription" in step ? step.pluginDescription : step.description;
  return <dialog ref={dialogRef} className="ws-tour" aria-labelledby="ws-tour-title" aria-describedby="ws-tour-description"
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.findIndex((button) => button === document.activeElement);
      if (!buttons.length || (event.shiftKey ? index <= 0 : index === buttons.length - 1)) {
        event.preventDefault();
        const target = (event.shiftKey ? buttons.at(-1) : buttons[0]) ?? headingRef.current;
        target?.focus();
      }
    }}
    onCancel={(event) => { event.preventDefault(); if (!finishing) onFinish(); }}>
    <div ref={spotlightRef} className="ws-tour-spotlight" hidden aria-hidden="true" />
    <div ref={cardRef} className="ws-tour-card" aria-busy={finishing}>
      <p className="ws-tour-progress">工作台導覽 · {stepIndex + 1} / {steps.length}</p>
      <h2 ref={headingRef} id="ws-tour-title" tabIndex={-1}>{title}</h2>
      <p id="ws-tour-description">{description}</p>
      <div className="ws-tour-actions">
        <button type="button" className="ws-tour-skip" disabled={finishing} onClick={onFinish}>跳過導覽</button>
        <button type="button" className="ws-secondary" disabled={finishing || stepIndex === 0}
          onClick={() => onStep(stepIndex - 1)}>上一步</button>
        <button type="button" className="ws-primary" disabled={finishing}
          onClick={() => last ? onFinish() : onStep(stepIndex + 1)}>{finishing ? "儲存中…" : last ? "完成" : "下一步"}</button>
      </div>
    </div>
  </dialog>;
}
