import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { Picture, Turn } from "./model";
import { Icon, PanelDialog, PictureImage, useImageUrl } from "./ui";

type Camera = { zoom: number; x: number; y: number };
type Version = { picture: Picture; label: string };
const fitted: Camera = { zoom: 100, x: 0, y: 0 };
const clamp = (value: number) => Math.max(-1, Math.min(1, value));

function ImageLayer({ picture, camera }: { picture: Picture; camera: Camera }) {
  const style = { "--ratio": picture.width / picture.height, "--zoom": camera.zoom / 100,
    "--pan-x": camera.x / 2, "--pan-y": camera.y / 2 } as CSSProperties;
  return <div className="ws-image-layer" style={style}><PictureImage source={picture.source} alt={picture.title} /></div>;
}

function ImageViewport({ picture, camera, onChange, label, after }: {
  picture: Picture; camera: Camera; onChange: (camera: Camera) => void; label: string;
  after?: { version: Version; position: number; onPosition: (position: number) => void };
}) {
  const drag = useRef<{ id: number; x: number; y: number; shift: Camera } | null>(null);
  const zoomed = camera.zoom > 100;
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const { width, height } = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(width / picture.width, height / picture.height) * camera.zoom / 100;
    const extraX = Math.max(0, picture.width * scale - width);
    const extraY = Math.max(0, picture.height * scale - height);
    onChange({ zoom: camera.zoom,
      x: extraX ? clamp(start.shift.x + 2 * (event.clientX - start.x) / extraX) : 0,
      y: extraY ? clamp(start.shift.y + 2 * (event.clientY - start.y) / extraY) : 0 });
  };
  return <div className="ws-image-viewport" role="group" aria-label={label} tabIndex={0} data-zoomed={zoomed}
    style={after ? {
      "--divider": after.position / 100,
      "--clip-edge": after.position === 0 || after.position === 100 ? `${after.position}%` : undefined,
    } as CSSProperties : undefined}
    onPointerDown={(event) => {
      if (!zoomed || event.button !== 0 || event.target instanceof HTMLInputElement) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, shift: camera };
    }}
    onPointerMove={move} onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={(event) => {
      if (!(event.target instanceof HTMLInputElement)) onChange(zoomed ? fitted : { ...fitted, zoom: 200 });
    }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      const direction = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
      if (direction && zoomed) {
        onChange({ ...camera, x: clamp(camera.x + direction[0] * 0.15), y: clamp(camera.y + direction[1] * 0.15) });
      } else if (event.key === "+" || event.key === "=") {
        onChange({ ...camera, zoom: Math.min(300, camera.zoom + 25) });
      } else if (event.key === "-" || event.key === "0") {
        const zoom = event.key === "0" ? 100 : Math.max(100, camera.zoom - 25);
        onChange(zoom === 100 ? fitted : { ...camera, zoom });
      } else return;
      event.preventDefault();
    }}>
    <ImageLayer picture={picture} camera={camera} />
    {after && <>
      <div className="ws-wipe-overlay"><ImageLayer picture={after.version.picture} camera={camera} /></div>
      {after.position > 0 && after.position < 100 && <span className="ws-wipe-line" aria-hidden="true" />}
      <input className="ws-wipe-range" type="range" aria-label="比較分割線" aria-valuetext={`${after.version.label} ${after.position}%`}
        value={after.position} onChange={(event) => after.onPosition(Number(event.target.value))} />
    </>}
  </div>;
}

function Zoom({ camera, onChange, label }: { camera: Camera; onChange: (camera: Camera) => void; label: string }) {
  return <div className="ws-zoom">
    <label>{label}<input type="range" min={100} max={300} step={5} value={camera.zoom}
      onChange={(event) => {
        const zoom = Number(event.target.value);
        onChange(zoom === 100 ? fitted : { ...camera, zoom });
      }} /><span>{camera.zoom}%</span></label>
    <button type="button" className="ws-secondary" disabled={camera.zoom === 100} onClick={() => onChange(fitted)}>符合視窗</button>
  </div>;
}

export function Viewer({ picture, turn, version, onClose, onEdit, onNewSession, onCompare }: {
  picture: Picture; turn?: Turn; version?: string; onClose: () => void; onEdit: () => void;
  onNewSession: () => void; onCompare?: () => void;
}) {
  const url = useImageUrl(picture.source);
  const [camera, setCamera] = useState(fitted);
  const format = picture.source instanceof Blob ? picture.source.type.split("/")[1] || "png" : "webp";
  const fileName = picture.title.toLowerCase().endsWith(`.${format}`) || format === "jpeg" && /\.jpg$/i.test(picture.title)
    ? picture.title : `${picture.title}.${format}`;
  const seedField = turn?.provider?.sent.fields;
  const seedValue = seedField?.seed ?? seedField?.noise_seed;
  const sentSeed = typeof seedValue === "string" && /^\d+$/.test(seedValue) ? Number(seedValue) : seedValue;
  const imageSeed = turn?.provider?.imageSeed;
  const responseSeed = turn?.provider?.response.seed;
  const batch = (turn?.provider?.response.count ?? 0) > 1;
  const revisedPrompt = turn?.provider?.revisedPrompt;
  return <PanelDialog title={picture.title} onClose={onClose} className="ws-viewer">
    <ImageViewport picture={picture} label="圖片檢視" camera={camera} onChange={setCamera} />
    <div className="ws-viewer-actions">
      <Zoom camera={camera} onChange={setCamera} label="縮放" />
      <a className="ws-secondary" href={url || undefined} download={fileName}>
        <Icon name="download" />下載
      </a>
      {onCompare && <button type="button" className="ws-secondary" onClick={onCompare}>與來源圖比較</button>}
      <button type="button" className="ws-secondary" onClick={onNewSession}>從圖片建立會話</button>
      <button type="button" className="ws-primary" onClick={onEdit}>以此圖編輯</button>
    </div>
    <dl className="ws-picture-info">
      <div><dt>尺寸</dt><dd>{picture.width} × {picture.height} px</dd></div>
      <div><dt>格式</dt><dd>{format.toUpperCase()}</dd></div>
      {version && <div><dt>版本</dt><dd>{version}</dd></div>}
      {turn?.provider && <div><dt>模型</dt><dd>{turn.provider.model}</dd></div>}
      {turn?.request && !turn.provider && <div><dt>Seed</dt><dd>{turn.request.seed}</dd></div>}
      {typeof sentSeed === "number" && <div><dt>送出 Seed</dt><dd>{sentSeed}</dd></div>}
      {typeof imageSeed === "number" && <div><dt>圖片 Seed（Provider 回傳）</dt><dd>{imageSeed}</dd></div>}
      {typeof responseSeed === "number" && (batch || responseSeed !== imageSeed) &&
        <div><dt>{batch ? "批次 Seed（Provider 回傳）" : "回傳 Seed"}</dt><dd>{responseSeed}</dd></div>}
      {turn?.provider && typeof sentSeed !== "number" && typeof imageSeed !== "number" && typeof responseSeed !== "number" &&
        <div><dt>Seed</dt><dd>模型未提供</dd></div>}
      {turn?.createdAt !== undefined && <div><dt>生成時間</dt><dd>{new Date(turn.createdAt).toLocaleString("zh-TW")}</dd></div>}
      {turn?.originalPrompt && turn.originalPrompt !== turn.prompt && <div className="ws-picture-prompt">
        <dt>原始提示詞</dt><dd>{turn.originalPrompt}</dd>
      </div>}
      {turn?.enhancedPrompt && turn.enhancedPrompt !== turn.prompt && turn.enhancedPrompt !== revisedPrompt && <div className="ws-picture-prompt">
        <dt>增強候選</dt><dd>{turn.enhancedPrompt}</dd>
      </div>}
      {turn && <div className="ws-picture-prompt"><dt>{turn.request ? "送出提示詞" : "提示詞"}</dt><dd>{turn.prompt}</dd></div>}
      {revisedPrompt && revisedPrompt !== turn?.prompt && <div className="ws-picture-prompt">
        <dt>Provider 改寫提示詞</dt><dd>{revisedPrompt}</dd>
      </div>}
    </dl>
  </PanelDialog>;
}

export function ImageComparison({ versions, startSplit, onClose }: {
  versions: Version[]; startSplit?: boolean; onClose: () => void;
}) {
  const [wipe, setWipe] = useState(Boolean(startSplit));
  const [position, setPosition] = useState(50);
  const [sync, setSync] = useState(true);
  const [camera, setCamera] = useState(fitted);
  const [individual, setIndividual] = useState<Record<string, Camera>>({});
  const split = wipe && versions.length === 2;
  return <PanelDialog title="比較圖片" onClose={onClose} className="ws-viewer">
    <div className="ws-dialog-content">
      <div className="ws-compare-controls">
        {versions.length === 2 && <button type="button" className="ws-secondary" aria-pressed={split}
          onClick={() => {
            if (!split && !sync) setCamera(individual[versions[0].picture.id] ?? fitted);
            setWipe(!split);
          }}>{split ? "切換並排" : "切換分割線"}</button>}
        {!split && <label><input type="checkbox" checked={sync} onChange={(event) => {
          setSync(event.target.checked);
          if (event.target.checked) setCamera(individual[versions[0].picture.id] ?? camera);
          else setIndividual(Object.fromEntries(versions.map(({ picture }) => [picture.id, camera])));
        }} />同步縮放與移動</label>}
        {(sync || split) && <Zoom camera={camera} onChange={setCamera} label="縮放" />}
      </div>
      {split ? <figure className="ws-wipe">
        <ImageViewport picture={versions[1].picture} camera={camera} onChange={setCamera} label="分割線圖片檢視"
          after={{ version: versions[0], position, onPosition: setPosition }} />
        <figcaption><span>{versions[0].label}</span><span>{versions[1].label}</span></figcaption>
      </figure> : <div className="ws-comparison-grid">
        {versions.map(({ picture, label }) => {
          const view = sync ? camera : individual[picture.id] ?? camera;
          const update = sync ? setCamera : (next: Camera) => setIndividual((current) => ({ ...current, [picture.id]: next }));
          return <figure key={picture.id}>
            <ImageViewport picture={picture} camera={view} onChange={update} label={`${label}圖片檢視`} />
            <figcaption>{label} · {picture.title}</figcaption>
            {!sync && <Zoom camera={view} onChange={update} label={`${label}縮放`} />}
          </figure>;
        })}
      </div>}
    </div>
  </PanelDialog>;
}
