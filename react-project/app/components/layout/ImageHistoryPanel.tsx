import { pictureDragType, type Picture, type Session, type Turn } from "../workspace/model";
import { Icon, IconButton, PictureImage } from "../workspace/ui";

export type HistoryView = "grid" | "timeline" | "versions";
const historyViews = [
  ["grid", "grid_view", "縮圖"],
  ["timeline", "history", "時間軸"],
  ["versions", "folder_open", "版本"],
] as const;

function versionEntries(turns: Turn[]) {
  const entries = turns.map((turn, index) => ({ turn, index, depth: 0 }));
  const byId = new Map(entries.map((entry) => [entry.turn.image.id, entry]));
  const children = new Map<string, typeof entries>();
  const roots: typeof entries = [];
  for (const entry of entries) {
    const { id, parentId } = entry.turn.image;
    if (!parentId || id === parentId || !byId.has(parentId)) {
      roots.push(entry);
      continue;
    }
    const branch = children.get(parentId) ?? [];
    branch.push(entry);
    children.set(parentId, branch);
  }
  const ordered: typeof entries = [];
  const seen = new Set<string>();
  function append(root: (typeof entries)[number]) {
    const pending = [root];
    while (pending.length) {
      const entry = pending.pop()!;
      const id = entry.turn.image.id;
      if (seen.has(id)) continue;
      seen.add(id);
      ordered.push(entry);
      const branch = children.get(id) ?? [];
      for (let index = branch.length - 1; index >= 0; index--) {
        pending.push({ ...branch[index], depth: entry.depth + 1 });
      }
    }
  }
  roots.forEach(append);
  entries.forEach(append);
  return ordered;
}

export function ImageHistoryPanel({ session, references, view, onView, selected, onToggle, onOpen, onEdit, onAdd, onCompare }: {
  session: Session; references: Picture[]; view: HistoryView; onView: (view: HistoryView) => void;
  selected: Picture[]; onToggle: (picture: Picture) => void; onOpen: (picture: Picture) => void;
  onEdit: (picture: Picture) => void; onAdd: () => void; onCompare: () => void;
}) {
  const entries = view === "versions" ? versionEntries(session.turns) : session.turns.map((turn, index) => ({ turn, index, depth: 0 }));
  const versionNumbers = new Map(session.turns.map(({ image }, index) => [image.id, index + 1]));
  const images = new Map([...references, ...session.turns.map(({ image }) => image)].map((image) => [image.id, image]));
  const cards = [
    ...entries.map(({ turn, index, depth }) => ({ picture: turn.image, label: `V${index + 1}`, depth, turn })),
    ...references.map((picture) => ({ picture, label: "參考圖", depth: 0, turn: undefined })),
  ];
  return (
    <>
      <div className="ws-history-controls" aria-label="歷史圖片檢視">
        {historyViews.map(([value, icon, label]) => <IconButton key={value} icon={icon} label={label}
          pressed={view === value} onClick={() => onView(value)} />)}
      </div>
      <div className={`ws-history-list ws-history-${view}`}>
        {!cards.length && <p className="ws-empty">這個會話還沒有圖片。</p>}
        {cards.map(({ picture, label, depth, turn }) => {
          const checked = selected.some(({ id }) => id === picture.id);
          const parent = picture.parentId && versionNumbers.get(picture.parentId);
          const source = picture.parentId ? images.get(picture.parentId) : undefined;
          return (
            <article key={picture.id} className="ws-history-card" data-selected={checked}
              data-branch={depth > 0} style={depth ? { marginInlineStart: Math.min(depth, 4) * 8 } : undefined}>
              <div className="ws-history-thumb" draggable onDragStart={(event) => {
                event.dataTransfer.setData(pictureDragType, picture.id);
                event.dataTransfer.effectAllowed = "copy";
              }}>
                <button type="button" aria-label={`檢視 ${label} ${picture.title}`} onClick={() => onOpen(picture)}>
                  <PictureImage source={picture.thumbnail ?? picture.source} alt="" />
                </button>
                <input type="checkbox" aria-label={`選取 ${label} ${picture.title}`} checked={checked}
                  disabled={!checked && selected.length >= 8} onChange={() => onToggle(picture)} />
              </div>
              <div className="ws-version-label">
                <strong>{label}</strong><span>{picture.title}</span>
                {view === "versions" && turn && <small>{source ? <button type="button" className="ws-version-source"
                  onClick={() => onOpen(source)}>{parent ? `來源 V${parent}` : `來源圖 · ${source.title}`}</button>
                  : picture.parentId ? "來源圖無法取得" : "原始版本"}</small>}
                {view === "timeline" && turn?.createdAt !== undefined && <time dateTime={new Date(turn.createdAt).toISOString()}>
                  {new Date(turn.createdAt).toLocaleString("zh-TW")}
                </time>}
                {view !== "grid" && <IconButton icon="edit" label={`以 ${label} ${picture.title} 編輯`} onClick={() => onEdit(picture)} />}
              </div>
            </article>
          );
        })}
      </div>
      {!!cards.length && <div className="ws-history-actions">
        <button type="button" className="ws-secondary" disabled={selected.length < 2 || selected.length > 4} onClick={onCompare}>
          <Icon name="compare" />比較{selected.length ? ` (${selected.length})` : ""}
        </button>
        <button type="button" className="ws-secondary" disabled={!selected.length} onClick={onAdd}>
          <Icon name="add" />加入參考圖
        </button>
      </div>}
    </>
  );
}
