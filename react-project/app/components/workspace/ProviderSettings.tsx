import { useState } from "react";
import { discoverModels } from "./provider-client";
import { deleteProfile, emptyProfile, gatewayProfile, nativeEnhanceSetting, persistedKey, profileKey, providerBase, saveProfile, type ProfilesPayload } from "./provider-profiles";
import type { ImageCapabilities, ProviderProfile } from "./provider-types";
import { PanelDialog } from "./ui";
import type { PluginConnection } from "./WorkspaceEntry";

const sizeFields = [["alignment", "長寬對齊"], ["minEdge", "最小邊長"], ["maxEdge", "最大邊長"],
  ["maxPixels", "最大總像素"], ["maxAspect", "最大長寬比（長邊／短邊）"]] as const;

export function ProviderSettings({ data, selectedId, onChange, onSelect, onClose, online, namespace, gateway }: {
  data: ProfilesPayload; selectedId?: string; onChange: (data: ProfilesPayload) => void;
  onSelect: (id?: string) => void; onClose: () => void; online: boolean;
  namespace: string; gateway?: { baseUrl: string; userId: string; plugin: PluginConnection };
}) {
  const initialProfile = gateway ? gatewayProfile(gateway.baseUrl, gateway.plugin.defaultModel) : emptyProfile;
  const [draft, setDraft] = useState(data.profiles.find(({ id }) => id === selectedId) ?? initialProfile);
  const [sizes, setSizes] = useState((draft.imageCapabilities?.fixedSizes ?? []).join(", "));
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const change = (fields: Partial<ProviderProfile>) => setDraft((current) => ({ ...current, ...fields }));
  const resetDiscovery = () => { setDiscovered([]); setStatus(""); };
  const capabilities = draft.imageCapabilities ?? {};
  const changeCapability = (fields: Partial<ImageCapabilities>) =>
    setDraft((current) => ({ ...current, imageCapabilities: { ...current.imageCapabilities, ...fields } }));
  const switchProfile = (id: string) => {
    const selected = data.profiles.find((item) => item.id === id) ?? initialProfile;
    setDraft(selected);
    setSizes((selected.imageCapabilities?.fixedSizes ?? []).join(", "));
    setKey(""); setClearKey(false); resetDiscovery();
  };

  async function operate(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setStatus("");
    try { await work(); }
    catch (error) { setStatus(error instanceof Error ? error.message : "無法完成 Provider 操作。"); }
    finally { setBusy(false); }
  }

  return <PanelDialog title={gateway ? "LiteLLM Gateway" : "Provider"} onClose={() => { if (!busy) onClose(); }}>
    <div className="ws-dialog-content">
      {gateway && <p>已驗證帳號 {gateway.userId}。{gateway.plugin.sharedGateway ? "使用伺服器的共用 Virtual Key。" : "請輸入此帳號的 LiteLLM Virtual Key。"}</p>}
      <label className="ws-field">本會話的 Provider<select value={selectedId ?? ""} disabled={busy}
        onChange={(event) => { onSelect(event.target.value || undefined); switchProfile(event.target.value); }}>
        <option value="" disabled={Boolean(gateway)}>{gateway
          ? !data.profiles.length && gateway.plugin.defaultModel ? `伺服器預設模型 · ${gateway.plugin.defaultModel}` : "使用第一個 Gateway Profile"
          : "本機示範"}</option>
        {selectedId && !data.profiles.some(({ id }) => id === selectedId) &&
          <option value={selectedId} disabled>目前 Provider 無法連線</option>}
        {data.profiles.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
      </select></label>
      {!online && <p className="ws-muted">目前離線，可切換至本機示範。</p>}
      <form className="ws-provider-form" onSubmit={(event) => {
        event.preventDefault();
        void operate(async () => {
          const next = saveProfile(namespace, { ...draft, baseUrl: gateway?.baseUrl ?? draft.baseUrl,
            imageCapabilities: { ...capabilities, fixedSizes: sizes.split(/[,，]/).map((value) => value.trim()).filter(Boolean) },
          }, key, clearKey);
          const saved = next.profiles.find(({ id }) => id === draft.id) ?? next.profiles.at(-1);
          onChange(next);
          if (saved) { setDraft(saved); setSizes((saved.imageCapabilities?.fixedSizes ?? []).join(", ")); onSelect(saved.id); }
          setKey(""); setClearKey(false); setStatus("已儲存 Provider。");
        });
      }}>
        <label className="ws-field">編輯 Profile<select value={draft.id} disabled={busy} onChange={(event) => switchProfile(event.target.value)}>
          <option value="">新增 Profile</option>
          {data.profiles.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
        </select></label>
        <label className="ws-field">Provider 名稱<input required maxLength={80} value={draft.name}
          onChange={(event) => change({ name: event.target.value })} /></label>
        <label className="ws-field">API Base URL<input type="url" required disabled={busy} readOnly={Boolean(gateway)}
          placeholder="https://api.example.com/v1" value={gateway?.baseUrl ?? draft.baseUrl}
          onChange={(event) => { change({ baseUrl: event.target.value }); resetDiscovery(); }} /></label>
        {!gateway?.plugin.sharedGateway && <><label className="ws-field">{gateway ? "Virtual Key" : "API Key"}<input type="password" autoComplete="new-password" value={key} disabled={busy}
          placeholder={draft.hasKey ? "已設定" : persistedKey(namespace, draft.id) ? "請重新輸入" : "依 Provider 需求填寫"}
          onChange={(event) => { setKey(event.target.value); setClearKey(false); resetDiscovery(); }} /></label>
        {(draft.hasKey || persistedKey(namespace, draft.id)) && <label><input type="checkbox" checked={clearKey} disabled={busy}
          onChange={(event) => { setClearKey(event.target.checked); resetDiscovery(); }} /> 移除此 Profile 的 API Key</label>}
        <p className="ws-muted">Profile 與 API Key 保存在此瀏覽器。可在這裡移除已儲存的 Key。</p></>}
        <label className="ws-field">模型 ID<input value={draft.model} maxLength={200}
          onChange={(event) => change({ model: event.target.value })} /></label>
        {!!discovered.length && <label className="ws-field">偵測到的模型<select value="" disabled={busy} onChange={(event) => change({ model: event.target.value })}>
          <option value="">從清單選擇</option>
          {discovered.map((model) => <option key={model} value={model}>{model}</option>)}
        </select></label>}
        <div className="ws-management-actions">
          <button type="button" className="ws-secondary" disabled={!online || !draft.baseUrl.trim() || busy}
            onClick={() => void operate(async () => {
              setDiscovered([]);
              const baseUrl = providerBase(gateway?.baseUrl ?? draft.baseUrl);
              const saved = profileKey(namespace, { id: draft.id, baseUrl });
              const models = await discoverModels(baseUrl, clearKey ? "" : key.trim() || saved, AbortSignal.timeout(15_000), gateway?.plugin);
              setDiscovered(models); setStatus(`連線成功，取得 ${models.length} 個模型。`);
            })}>測試連線並偵測模型</button>
        </div>
        <details>
          <summary>圖片端點與模型能力</summary>
          <label className="ws-field">Responses 主模型<input value={draft.responsesModel ?? ""} maxLength={200}
            placeholder="留空使用 Image API" onChange={(event) => change({ responsesModel: event.target.value })} /></label>
          {draft.responsesModel && <p className="ws-muted">Responses 工作流程會要求 Provider 保留上游回應，以便接續編輯。模型 ID 是圖片工具的模型。</p>}
          <label className="ws-field">提示詞增強文字模型<input value={draft.enhanceModel ?? ""} maxLength={200}
            onChange={(event) => change({ enhanceModel: event.target.value })} /></label>
          {!draft.responsesModel && <>
            <label className="ws-field">Provider Native 增強欄位<input value={draft.nativeEnhanceField ?? ""}
              placeholder="enhance_prompt" maxLength={80}
              onChange={(event) => change({ nativeEnhanceField: event.target.value })} /></label>
            <label className="ws-field">Provider Native 啟用值<select
              value={nativeEnhanceSetting(draft).value === "true" ? "string" : "boolean"}
              onChange={(event) => change({ nativeEnhanceField: draft.nativeEnhanceField || "enhance_prompt",
                nativeEnhanceValueType: event.target.value === "string" ? "string" : undefined })}>
              <option value="boolean">布林值 true</option>
              <option value="string">字串 "true"</option>
            </select></label>
          </>}
          <label className="ws-field">生成端點<input value={draft.generatePath} placeholder="/v1/images/generations"
            onChange={(event) => change({ generatePath: event.target.value })} /></label>
          <label className="ws-field">編輯端點<input value={draft.editPath} placeholder="/v1/images/edits"
            onChange={(event) => change({ editPath: event.target.value })} /></label>
          <div className="ws-management-actions">
            <label><input type="checkbox" checked={capabilities.generate !== false}
              onChange={(event) => changeCapability({ generate: event.target.checked })} /> 支援生成</label>
            <label><input type="checkbox" checked={draft.edits} onChange={(event) => change({ edits: event.target.checked })} /> 支援編輯</label>
            <label><input type="checkbox" checked={capabilities.mask === true} disabled={!draft.edits}
              onChange={(event) => changeCapability({ mask: event.target.checked })} /> 支援遮罩</label>
            <label><input type="checkbox" checked={draft.multiImage} disabled={!draft.edits && !draft.responsesModel}
              onChange={(event) => change({ multiImage: event.target.checked })} /> 多張參考圖</label>
            <label><input type="checkbox" checked={draft.sendSize} onChange={(event) => change({ sendSize: event.target.checked })} /> 送出尺寸</label>
            {draft.responsesModel && <label><input type="checkbox" checked={capabilities.responsesBackground === true}
              onChange={(event) => changeCapability({ responsesBackground: event.target.checked })} /> 支援 Responses 背景工作與取消</label>}
          </div>
          {draft.multiImage && <label className="ws-field">參考圖上限<input type="number" min={1} max={8} placeholder="8"
            value={capabilities.referenceLimit ?? ""} onChange={(event) => changeCapability({
              referenceLimit: event.target.value ? Number(event.target.value) : undefined,
            })} /></label>}
          {draft.sendSize && <div className="ws-capability-fields">
            <label className="ws-field">固定尺寸清單<input value={sizes} placeholder="1024x1024, 1536x1024"
              onChange={(event) => setSizes(event.target.value)} /></label>
            {sizeFields.map(([field, label]) => <label key={field} className="ws-field">{label}
              <input type="number" min={1} value={capabilities[field] ?? ""}
                onChange={(event) => changeCapability({ [field]: event.target.value ? Number(event.target.value) : undefined })} />
            </label>)}
          </div>}
          {!draft.responsesModel && <label className="ws-field">Seed 欄位<select value={draft.seedField} onChange={(event) => change({ seedField: event.target.value })}>
            <option value="">由模型決定</option><option value="seed">seed</option><option value="noise_seed">noise_seed</option>
          </select></label>}
          {!draft.responsesModel && <label className="ws-field">Images API 串流預覽數<select
            value={capabilities.partialImages ?? 0}
            onChange={(event) => changeCapability({ partialImages: Number(event.target.value) })}>
            <option value={0}>關閉</option>
            {[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}
          </select></label>}
          {!draft.responsesModel && draft.seedField && <div className="ws-capability-fields">
            {([["seedMin", "最小 Seed"], ["seedMax", "最大 Seed"]] as const).map(([field, label]) => <label key={field} className="ws-field">{label}
              <input type="number" min={0} max={4294967295} value={capabilities[field] ?? ""}
                onChange={(event) => changeCapability({ [field]: event.target.value ? Number(event.target.value) : undefined })} />
            </label>)}
          </div>}
        </details>
        <div className="ws-management-actions">
          <button type="submit" className="ws-primary" disabled={busy}>儲存 Provider</button>
          {draft.id && <button type="button" className="ws-secondary" disabled={busy} onClick={() => void operate(async () => {
            const next = deleteProfile(namespace, draft);
            onChange(next);
            if (selectedId === draft.id) onSelect();
            switchProfile("");
            setStatus("已移除 Provider。");
          })}>移除 Profile</button>}
        </div>
        {status && <p role="status">{status}</p>}
      </form>
      <p className="ws-muted">示範照片來源 <a href="https://unsplash.com/photos/995jo39qpI0" target="_blank" rel="noreferrer">新宿雨夜</a> 與
        {" "}<a href="https://unsplash.com/photos/ufz5qGckrLM" target="_blank" rel="noreferrer">霓虹街道</a>。</p>
    </div>
  </PanelDialog>;
}
