import { useRef } from "react";
import type { Picture } from "../workspace/model";
import { IconButton, PictureImage } from "../workspace/ui";

export function AttachmentList({ references, onChange, onPreview, onEmpty, edit, sourceVersion }: {
  references: Picture[]; onChange: (references: Picture[]) => void; onPreview: (picture: Picture) => void;
  onEmpty: () => void;
  edit: boolean; sourceVersion?: string;
}) {
  const dragged = useRef<number | null>(null);
  const previews = useRef(new Map<string, HTMLButtonElement>());
  function focusAttachment(id: string | undefined) {
    requestAnimationFrame(() => {
      if (id) previews.current.get(id)?.focus();
      else onEmpty();
    });
  }
  const move = (from: number, to: number) => {
    const reordered = [...references];
    const [picture] = reordered.splice(from, 1);
    reordered.splice(to, 0, picture);
    onChange(reordered);
  };
  function moveFromButton(from: number, to: number) {
    move(from, to);
    focusAttachment(references[from].id);
  }

  function remove(index: number, keyboard: boolean) {
    const remaining = references.filter((_, position) => position !== index);
    onChange(remaining);
    if (keyboard) focusAttachment(remaining[Math.min(index, remaining.length - 1)]?.id);
  }

  if (!references.length) return null;
  return (
    <ol className="ws-reference-list" aria-label="參考圖順序">
      {references.map((picture, index) => (
        <li key={picture.id} draggable onDragStart={() => { dragged.current = index; }}
          onDragEnd={() => { dragged.current = null; }}
          onDrop={(event) => {
            if (dragged.current === null) return;
            event.preventDefault();
            event.stopPropagation();
            if (dragged.current !== index) move(dragged.current, index);
            dragged.current = null;
          }}>
          <button type="button" className="ws-attachment-preview" aria-label={`預覽 ${picture.title}，第 ${index + 1} 張`}
            ref={(element) => {
              if (element) previews.current.set(picture.id, element);
              else previews.current.delete(picture.id);
            }} onClick={() => onPreview(picture)}>
            <PictureImage source={picture.thumbnail ?? picture.source} alt="" />
          </button>
          <span title={picture.title}>
            {edit && index === 0 && <strong className="ws-attachment-role">
              {sourceVersion ? `來源 ${sourceVersion}` : "來源圖"}
            </strong>}
            {index + 1}. {picture.title}
          </span>
          <IconButton icon="arrow_upward" label={`前移 ${picture.title}，第 ${index + 1} 張`} disabled={index === 0}
            onClick={() => moveFromButton(index, index - 1)} />
          <IconButton icon="arrow_downward" label={`後移 ${picture.title}，第 ${index + 1} 張`}
            disabled={index === references.length - 1} onClick={() => moveFromButton(index, index + 1)} />
          <IconButton icon="close" label={`移除 ${picture.title}，第 ${index + 1} 張`}
            onClick={(event) => remove(index, event.detail === 0)} />
        </li>
      ))}
    </ol>
  );
}
