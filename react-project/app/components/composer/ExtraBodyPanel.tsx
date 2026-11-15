import { useId, useRef, useState } from "react";
import { dimensions, parseExtraSize, requestDimensions, requestExtraBody, requestPreview, resolutionForMode, type Draft, type ExtraOverride, type ExtraOverrides, type JsonObject, type Mode } from "../workspace/model";
import { sendImage } from "../workspace/provider-client";
import type { ProviderPreview, ProviderProfile } from "../workspace/provider-types";
import { sizeProblem } from "../workspace/image-capabilities";
import { Icon, PanelDialog, StatusMark } from "../workspace/ui";

function parseBody(text: string): { body?: JsonObject; error?: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return { body: value as JsonObject };
    return { error: "最外層須為 JSON 物件（{ }）。" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const position = /position (\d+)/i.exec(message);
    const explicit = /line (\d+) column (\d+)/i.exec(message);
    const lines = text.slice(0, position ? Number(position[1]) : text.length).split("\n");
    return { error: `JSON 語法錯誤（第 ${explicit?.[1] ?? lines.length} 行，第 ${explicit?.[2] ?? lines.at(-1)!.length + 1} 欄）。` };
  }
}

const fieldSuggestions = { quality: "high", output_format: "png", background: "auto", output_compression: 90, n: 1 };

export function ExtraBodyPanel({ draft, onApply, onClose, profile, namespace }: {
  draft: Draft; onApply: (extra: Draft["extra"], overrides: ExtraOverrides) => void; onClose: () => void;
  profile?: ProviderProfile;
  namespace: string;
}) {
  const validationId = useId();
  const [mode, setMode] = useState(draft.mode);
  const [text, setText] = useState({
    generate: JSON.stringify(draft.extra.generate, null, 2),
    edit: JSON.stringify(draft.extra.edit, null, 2),
  });
  const [overrides, setOverrides] = useState(draft.extraOverrides ?? {});
  const [preview, setPreview] = useState<{ context: string; request?: ProviderPreview; error?: string }>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const bodies = { generate: parseBody(text.generate), edit: parseBody(text.edit) };
  const parsed = bodies[mode];
  const active = parsed.body;
  const generate = bodies.generate.body;
  const edit = bodies.edit.body;
  const sizedDraft = resolutionForMode(draft, mode);
  const [width, height] = dimensions(sizedDraft, profile);
  const suggestions = { ...fieldSuggestions, size: `${width}x${height}` };
  function overrideProblem(target: Mode, body: JsonObject | undefined) {
    const selected = overrides[target];
    const count = body?.n;
    if (body && Object.hasOwn(body, "n") && !profile?.responsesModel && (!draft.batchSize || selected?.includes("n"))
        && (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 4)) return "n 須為 1 至 4 的整數。";
    if (body && selected?.includes("size") && Object.hasOwn(body, "size") && (!profile || profile.sendSize)) {
      const size = parseExtraSize(body.size);
      return size ? sizeProblem(...size, profile) : "size 須為「寬x高」，例如 1024x1024。";
    }
    return "";
  }
  const problem = overrideProblem(mode, active);
  const availableOverrides = active ? (["size", "n"] as const).filter((field) => Object.hasOwn(active, field) &&
    (field === "size" ? !profile || profile.sendSize : !profile?.responsesModel && Boolean(draft.batchSize))) : [];
  const next = { ...sizedDraft, batchSize: profile?.responsesModel ? undefined : draft.batchSize,
    extra: { ...draft.extra, [mode]: active ?? {} }, extraOverrides: overrides };
  const previewContext = JSON.stringify([mode, text[mode], overrides, profile?.id, profile?.revision]);
  const visiblePreview = preview?.context === previewContext ? preview : undefined;
  async function inspectRequest() {
    if (!active || !profile) return;
    setPreviewBusy(true);
    try {
      const sent = await sendImage(next, requestPreview(next, undefined, profile), profile, AbortSignal.timeout(10_000), true, namespace);
      setPreview({ context: previewContext, request: sent });
    } catch (error) {
      setPreview({ context: previewContext, error: error instanceof Error ? error.message : "無法預覽請求。" });
    } finally { setPreviewBusy(false); }
  }
  return (
    <PanelDialog title="Extra Body" className="ws-extra-dialog" onClose={onClose}>
      <div className="ws-dialog-content">
        <div className="ws-mode-control" aria-label="Extra Body 模式">
          {(["generate", "edit"] as const).map((value) => <button type="button" key={value}
            aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "generate" ? "Generation" : "Edit"}</button>)}
        </div>
        <label className="ws-field">JSON 編輯器<textarea rows={8} value={text[mode]} spellCheck={false}
          aria-invalid={!active || Boolean(problem)} aria-describedby={validationId}
          onChange={(event) => setText({ ...text, [mode]: event.target.value })} /></label>
        <p id={validationId} role="status" className={`ws-status-line ${active && !problem ? "ws-success" : "ws-error"}`}>
          <StatusMark tone={active && !problem ? "success" : "error"} />
          {parsed.error ?? (problem || "有效的 JSON 物件")}
        </p>
        {active && <label className="ws-field">自動補全欄位<select value="" onChange={(event) => {
          const field = event.target.value as keyof typeof suggestions;
          if (Object.hasOwn(suggestions, field)) setText({ ...text, [mode]: JSON.stringify({ ...active, [field]: suggestions[field] }, null, 2) });
        }}>
          <option value="">選擇欄位</option>
          {Object.keys(suggestions).filter((field) => !Object.hasOwn(active, field)
            && (field !== "n" || !profile?.responsesModel) && (field !== "size" || !profile || profile.sendSize))
            .map((field) => <option key={field}>{field}</option>)}
        </select></label>}
        {availableOverrides.map((field: ExtraOverride) => {
          const enabled = overrides[mode]?.includes(field) ?? false;
          const interfaceValue = field === "size" ? suggestions.size : draft.batchSize;
          return <label className="ws-radio ws-warning" key={field}>
            <input type="checkbox" checked={enabled} onChange={(event) => {
              const previous = overrides[mode] ?? [];
              setOverrides({ ...overrides, [mode]: event.target.checked ? [...previous, field] : previous.filter((value) => value !== field) });
            }} />
            <span>允許 JSON 覆寫 {field} · {enabled ? "使用 JSON 值" : `使用介面值 ${interfaceValue}`}</span>
          </label>;
        })}
        <h3>Request Preview{profile ? "" : " · 本機示範"}</h3>
        {profile ? <>
          <button type="button" className="ws-secondary" disabled={!active || Boolean(problem) || previewBusy}
            onClick={() => void inspectRequest()}>檢查上游請求</button>
          {visiblePreview?.error && <p className="ws-error" role="status">{visiblePreview.error}</p>}
          {visiblePreview?.request && <>
            {visiblePreview.request.conflicts.length > 0 && <p className="ws-warning" role="status">
              已略過 Extra Body 欄位 {visiblePreview.request.conflicts.join("、")}。採用值見下方預覽。
            </p>}
            <pre className="ws-json-preview">{JSON.stringify(visiblePreview.request, null, 2)}</pre>
          </>}
        </> : <pre className="ws-json-preview">{active && !problem ? JSON.stringify({
          mode, prompt: draft.prompt.trim(), dimensions: requestDimensions(next), extraBody: requestExtraBody(next),
          seed: draft.seedMode === "random" ? "隨機" : Number(draft.seed), references: draft.references.map(({ id }) => id),
        }, null, 2) : "修正 JSON 後顯示預覽。"}</pre>}
        <button type="button" className="ws-primary" disabled={!generate || !edit || Boolean(
          overrideProblem("generate", generate) || overrideProblem("edit", edit),
        )} onClick={() => {
          if (generate && edit) onApply({ generate, edit }, overrides);
        }}>套用</button>
      </div>
    </PanelDialog>
  );
}
