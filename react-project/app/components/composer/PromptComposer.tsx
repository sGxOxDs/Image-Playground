import { useId, useRef, type ReactNode } from "react";
import { dimensions, maskProblem, parseExtraSize, pictureDragType, randomSeed, ratioBasis, ratios, requestDimensions, resolutionProblem, type Draft, type Picture } from "../workspace/model";
import type { ProviderProfile } from "../workspace/provider-types";
import { imageLimits, referenceLimit, supportsMask, supportsSeed } from "../workspace/image-capabilities";
import { Icon, IconButton, PictureImage } from "../workspace/ui";
import { AttachmentList } from "./AttachmentList";

const enhanceChoices = { off: "關閉", auto: "自動增強", provider: "Provider Native" } as const;
const seedChoices = { random: "隨機", fixed: "固定", manual: "手動" } as const;
export type AttachmentIssue = { filename: string; reason: string };

type ToolbarOption = { icon: string; label: string; id?: string; disabled?: boolean; changed?: boolean; action?: () => void };

function OptionButton({ option }: { option: ToolbarOption }) {
  return <button type="button" className="ws-chip" title={option.label} popoverTarget={option.id} disabled={option.disabled}
    aria-haspopup={option.action ? "dialog" : undefined} onClick={option.action}>
    <Icon name={option.icon} /><span className="ws-chip-label">{option.label}</span>
  </button>;
}

function Option({ option, children }: { option: ToolbarOption; children: ReactNode }) {
  return (
    <>
      {option.changed !== false && <OptionButton option={option} />}
      <div id={option.id} popover="auto" className="ws-popover" aria-label={option.label}>
        {children}
      </div>
    </>
  );
}

function aspectLabel(width: number, height: number) {
  if (![width, height].every((value) => Number.isSafeInteger(value) && value > 0)) return "比例／尺寸";
  let a = width;
  let b = height;
  while (b) [a, b] = [b, a % b];
  return `${width / a}:${height / a} · ${width} × ${height}`;
}

export function PromptComposer({ draft, update, onFiles, onMask, onPreview, onHistoryDrop, onSubmit, onExtra, connected, profile,
  availableProfiles, standalone, sourceVersion, followLatestImage, onToggleFollowLatestImage, onProvider,
  attachmentIssues, dismissAttachmentIssues, maskUploadIssue }: {
  draft: Draft; sourceVersion?: string; update: (change: Partial<Draft>) => void;
  followLatestImage: boolean; onToggleFollowLatestImage: () => void; onProvider: () => void;
  attachmentIssues: AttachmentIssue[]; dismissAttachmentIssues: () => void;
  maskUploadIssue?: string;
  onFiles: (files: File[]) => void; onSubmit: () => void;
  onMask: (file: File) => void;
  onPreview: (picture: Picture) => void;
  onHistoryDrop: (id: string) => void;
  onExtra: () => void; connected: boolean; profile?: ProviderProfile;
  availableProfiles: ProviderProfile[]; standalone: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const maskInput = useRef<HTMLInputElement>(null);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const prefix = useId();
  const more = useRef<HTMLDivElement>(null);
  const [width, height] = requestDimensions(draft, profile);
  const { alignment, fixedSizes, minEdge, maxEdge, maxPixels, seedMin, seedMax } = imageLimits(profile);
  const basis = ratioBasis(draft);
  const ratioLongEdge = draft.ratioLongEdge ?? Math.max(...dimensions(draft, profile));
  const noSize = Boolean(profile && !profile.sendSize);
  const invalidSize = resolutionProblem(draft, profile);
  const invalidMask = maskProblem(draft, profile);
  const usingExtraSize = !noSize && draft.extraOverrides?.[draft.mode]?.includes("size")
    && Boolean(parseExtraSize(draft.extra[draft.mode].size));
  const canUseMask = draft.mode === "edit" && (supportsMask(profile) || Boolean(draft.mask));
  const canUseContext = Boolean(profile?.responsesModel && draft.mode === "edit" && !draft.mask && draft.references[0]?.continuation);
  const options = {
    pe: { id: prefix + "-pe", icon: "auto_awesome", label: `PE · ${enhanceChoices[draft.enhance]}`,
      changed: draft.enhance !== (profile && !profile.responsesModel ? "provider" : "off") },
    seed: { id: prefix + "-seed", icon: "settings", label: !supportsSeed(profile) ? "Seed 由模型決定" : `Seed · ${seedChoices[draft.seedMode]}`,
      disabled: !supportsSeed(profile), changed: supportsSeed(profile) && draft.seedMode !== "random" },
    extra: { icon: "code", label: "Extra Body", changed: Object.keys(draft.extra[draft.mode]).length > 0,
      action: () => { more.current?.hidePopover(); onExtra(); } },
    batch: { id: prefix + "-batch", icon: "imagesmode", label: draft.batchSize ? `${draft.batchSize} 張` : "批次",
      changed: draft.batchSize !== undefined },
    mask: { id: prefix + "-mask", icon: "image", label: draft.mask ? "已加入遮罩" : "PNG 遮罩", changed: Boolean(draft.mask) },
    context: { id: prefix + "-context", icon: "history", label: draft.useResponseContext === false ? "上游上下文 · 關閉" : "上游上下文",
      changed: draft.useResponseContext === false },
  } satisfies Record<string, ToolbarOption>;
  const defaultOptions: ToolbarOption[] = [options.pe, options.seed, options.extra, ...(!profile?.responsesModel ? [options.batch] : []),
    ...(canUseMask ? [options.mask] : []), ...(canUseContext ? [options.context] : [])].filter(({ changed }) => !changed);
  function changeSeedMode(mode: Draft["seedMode"]) {
    const fixedSeed = draft.seedMode === "fixed" ? draft.seed : draft.fixedSeed;
    update({ seedMode: mode, fixedSeed, seed: mode === "fixed" ? fixedSeed || String(randomSeed(profile)) : "" });
  }
  return (
    <div className="ws-composer-dock">
      <form className="ws-composer" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const id = event.dataTransfer.getData(pictureDragType);
          if (id) onHistoryDrop(id);
          else onFiles(Array.from(event.dataTransfer.files));
        }}>
        <div className="ws-composer-top">
          <span className="ws-muted" role="status">{draft.mode === "edit" ? "圖片編輯" : "圖片生成"}</span>
          <button type="button" className="ws-chip" aria-pressed={followLatestImage}
            title="每次生成或編輯完成後，自動將最新結果設為下一輪來源圖"
            onClick={onToggleFollowLatestImage}>
            <Icon name={followLatestImage ? "check" : "history"} />沿用最新圖
          </button>
        </div>
        <AttachmentList references={draft.references} edit={draft.mode === "edit"} sourceVersion={sourceVersion}
          onChange={(references) => update({ references })} onPreview={onPreview} onEmpty={() => promptInput.current?.focus()} />
        {attachmentIssues.length > 0 && <div className="ws-attachment-feedback">
          <div className="ws-attachment-issues ws-warning" role="status" aria-label="參考圖匯入結果">
            <ul>{attachmentIssues.map(({ filename, reason }, index) =>
              <li key={index}><strong>{filename}</strong> · {reason}</li>)}</ul>
          </div>
          <IconButton icon="close" label="關閉參考圖匯入提示" onClick={() => {
            dismissAttachmentIssues();
            promptInput.current?.focus();
          }} />
        </div>}
        {!!draft.references.length && <p className="ws-muted ws-reference-limit">
          {draft.references.length}/{referenceLimit(profile)} 張參考圖 · PNG、JPG、WebP · 每張上限 12 MB
        </p>}
        {(maskUploadIssue || invalidMask) && <p className="ws-error ws-mask-error" role="status">{maskUploadIssue || invalidMask}</p>}
        <textarea ref={promptInput} aria-label="提示詞" value={draft.prompt} rows={2}
          placeholder={draft.mode === "edit" ? "描述這張圖片要如何修改…" : "描述你想生成的畫面…"}
          onChange={(event) => update({ prompt: event.target.value })}
          onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.length) onFiles(files); }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229
                || window.matchMedia("(max-width: 767px)").matches) return;
            event.preventDefault();
            onSubmit();
          }} />
        <div className="ws-composer-actions">
          <div className="ws-toolbar">
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
              onChange={(event) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
            <IconButton icon="add" label="加入參考圖" disabled={draft.references.length >= referenceLimit(profile)}
              onClick={() => input.current?.click()} />
            <Option option={{ id: prefix + "-model", icon: "settings",
              label: profile?.model || profile?.name || (connected ? "選擇模型" : "本機示範") }}>
              <label>本次 Provider／模型<select value={draft.profileOverride === null ? "@demo" : draft.profileOverride ?? ""}
                onChange={(event) => update({ profileOverride: event.target.value === "@demo" ? null : event.target.value || undefined })}>
                <option value="">使用會話預設</option>
                {standalone && <option value="@demo">本機示範</option>}
                {typeof draft.profileOverride === "string" && !availableProfiles.some(({ id }) => id === draft.profileOverride)
                  && <option value={draft.profileOverride} disabled>所選模型無法使用</option>}
                {availableProfiles.map(({ id, model, name }) => <option key={id} value={id}>{name} · {model}</option>)}
              </select></label>
              <button type="button" className="ws-secondary" onClick={(event) => {
                event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
                onProvider();
              }}>Provider 設定</button>
            </Option>
            <Option option={{ id: prefix + "-size", icon: "tune", disabled: noSize,
              label: noSize ? "模型預設尺寸" : usingExtraSize || draft.sizeMode === "custom" || fixedSizes.length
                ? aspectLabel(width, height) : draft.ratio === "original" ? "原圖比例" : draft.ratio === "reference" ? "參考圖比例"
                  : draft.ratio === "custom" ? "自訂比例" : draft.ratio }}>
              <h3>解析度</h3>
              {fixedSizes.length ? <label>固定尺寸<select value={dimensions(draft, profile).join("x")} onChange={(event) => update({ fixedSize: event.target.value })}>
                {fixedSizes.map((size) => <option key={size} value={size}>{size.replace("x", " × ")}</option>)}
              </select></label> : <><label>模式<select value={draft.sizeMode} onChange={(event) => {
                const sizeMode = event.target.value as Draft["sizeMode"];
                update({ sizeMode, ...(sizeMode === "ratio" && ratioLongEdge > 0 ? { ratioLongEdge } : {}) });
              }}>
                <option value="ratio">比例</option><option value="mp">目標 MP</option><option value="custom">自訂尺寸</option>
              </select></label>
              {draft.sizeMode === "custom" ? <div className="ws-fields-inline">
                <label>寬度<input type="number" min={minEdge} max={maxEdge} value={draft.width || ""}
                  onChange={(event) => update({ width: Number(event.target.value) })} /></label>
                <label>高度<input type="number" min={minEdge} max={maxEdge} value={draft.height || ""}
                  onChange={(event) => update({ height: Number(event.target.value) })} /></label>
              </div> : <>
                <label>比例<select value={draft.ratio} onChange={(event) => update({
                  ratio: event.target.value, ...(draft.sizeMode === "ratio" && ratioLongEdge > 0 ? { ratioLongEdge } : {}),
                })}>
                  {ratios.map((ratio) => <option value={ratio} key={ratio}>{ratio === "original" ? "原圖（第一張來源圖）"
                    : ratio === "reference" ? "選擇參考圖" : ratio === "custom" ? "自訂比例" : ratio}</option>)}
                </select></label>
                {draft.ratio === "reference" && <label>比例基準圖<select value={draft.ratioReferenceId ?? ""} onChange={(event) =>
                  update({ ratioReferenceId: event.target.value || undefined })}>
                  <option value="">選擇已附加的圖片</option>
                  {draft.references.map((picture, index) => <option key={picture.id} value={picture.id}>{index + 1}. {picture.title}</option>)}
                </select></label>}
                {draft.ratio === "custom" && <div className="ws-fields-inline">
                  <label>比例寬<input type="number" min={1} step={1} value={draft.ratioWidth ?? ""}
                    onChange={(event) => update({ ratioWidth: event.target.value ? Number(event.target.value) : undefined })} /></label>
                  <label>比例高<input type="number" min={1} step={1} value={draft.ratioHeight ?? ""}
                    onChange={(event) => update({ ratioHeight: event.target.value ? Number(event.target.value) : undefined })} /></label>
                </div>}
                {basis && basis.every((dimension) => dimension > 0) && <p className="ws-muted">維持 {basis.join(" : ")}，對齊至 {alignment} px 的倍數。</p>}
                {draft.sizeMode === "ratio"
                  ? <label>長邊尺寸（px）<input type="number" min={minEdge} max={maxEdge} step={1} value={ratioLongEdge || ""}
                    onChange={(event) => update({ ratioLongEdge: Number(event.target.value) })} /></label>
                  : <label>像素預算（MP）<input type="number" min={0.000001} max={maxPixels / 1_000_000} step="any"
                    value={draft.megapixels || ""} onChange={(event) => update({ megapixels: Number(event.target.value) })} /></label>}
              </>}</>}
              <p role="status" className={invalidSize ? "ws-error" : "ws-muted"}>
                {invalidSize || `${usingExtraSize ? "Extra Body 覆寫" : "預計輸出"} ${width} × ${height} px`}
              </p>
            </Option>
            <Option option={options.pe}>
              <h3>提示詞增強</h3>
              {(Object.entries(enhanceChoices) as [Draft["enhance"], string][]).map(([value, label]) => {
                const unavailable = value === "provider" && (!profile || Boolean(profile.responsesModel))
                  || value === "auto" && connected && !profile?.enhanceModel;
                return <label key={value} className="ws-radio"><input type="radio" checked={draft.enhance === value}
                  disabled={unavailable} onChange={() => update({ enhance: value })} />{label}
                  {unavailable && <span>{value === "auto" ? "請設定提示詞增強文字模型"
                    : profile?.responsesModel ? "Responses 模式可使用自動增強"
                    : "請選擇支援 Image API 的 Provider"}</span>}</label>;
              })}
            </Option>
            <Option option={options.seed}>
              <h3>Seed</h3>
              <label>模式<select value={draft.seedMode} onChange={(event) => changeSeedMode(event.target.value as Draft["seedMode"])}>
                {Object.entries(seedChoices).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select></label>
              {draft.seedMode !== "random" && <label>Seed 值<input inputMode="numeric" value={draft.seed}
                onChange={(event) => update({ seed: event.target.value })} /></label>}
              {draft.seedMode === "fixed" && <button type="button" className="ws-secondary"
                onClick={() => update({ seed: String(randomSeed(profile)) })}>產生固定 Seed</button>}
              <p className="ws-muted">{seedMin}–{seedMax}</p>
            </Option>
            {options.extra.changed && <OptionButton option={options.extra} />}
            {!profile?.responsesModel && <Option option={options.batch}>
              <h3>每次輸出張數</h3>
              <label>張數<select value={draft.batchSize ?? ""} onChange={(event) =>
                update({ batchSize: Number(event.target.value) || undefined })}>
                <option value="">模型預設或 Extra Body</option>
                {[1, 2, 3, 4].map((count) => <option value={count} key={count}>{count} 張</option>)}
              </select></label>
            </Option>}
            {canUseMask && <Option option={options.mask}>
              <h3>PNG 遮罩</h3>
              <div className="ws-mask-control">
                <input ref={maskInput} type="file" accept="image/png" hidden onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onMask(file);
                  event.target.value = "";
                }} />
                {draft.mask ? <>
                  <span>遮罩：{draft.mask.title}</span>
                  {supportsMask(profile) && <button type="button" className="ws-secondary"
                    onClick={() => maskInput.current?.click()}>更換遮罩</button>}
                  <IconButton icon="close" label="移除編輯遮罩" onClick={() => update({ mask: undefined })} />
                </> : <button type="button" className="ws-secondary"
                  onClick={() => maskInput.current?.click()}>加入 PNG 遮罩</button>}
                <small>透明區域可編輯，尺寸須與第一張來源圖一致。</small>
              </div>
            </Option>}
            {canUseContext && <Option option={options.context}>
              <label className="ws-context-choice"><input type="checkbox" checked={draft.useResponseContext !== false}
                onChange={(event) => update({ useResponseContext: event.target.checked })} />沿用來源版本的上游上下文</label>
            </Option>}
            <OptionButton option={{ id: prefix + "-more", icon: "more_horiz", label: "更多", disabled: !defaultOptions.length }} />
            <div ref={more} id={prefix + "-more"} popover="auto" className="ws-popover ws-more-options" aria-label="更多選項">
              {defaultOptions.map((option) => <OptionButton key={option.id ?? option.label} option={option} />)}
            </div>
          </div>
          <button type="submit" className="ws-primary" aria-label={connected ? "送出 Provider 圖片請求" : "執行示範"}>
              <Icon name="auto_awesome" />{connected ? (draft.mode === "edit" ? "送出編輯" : "生成圖片")
                : (draft.mode === "edit" ? "示範編輯" : "示範生成")}
          </button>
        </div>
      </form>
    </div>
  );
}
