import { useRef, useState } from "react";
import type { Session } from "../workspace/model";
import { Icon } from "../workspace/ui";

export function SessionSidebar({ sessions, id, query, onQuery, onSelect, onNew }: {
  sessions: Session[]; id: string; query: string; onQuery: (query: string) => void;
  onSelect: (id: string) => void; onNew: () => void;
}) {
  const [archived, setArchived] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const matching = sessions.filter((session) => Boolean(session.archived) === archived
    && session.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
      || (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
  return (
    <>
      <button type="button" className="ws-new" onClick={onNew}><Icon name="add" />新建會話</button>
      <label className="ws-search"><Icon name="search" />
        <input ref={searchInput} type="search" aria-label="搜尋會話" placeholder="搜尋會話" value={query}
          onChange={(event) => onQuery(event.target.value)} />
      </label>
      <button type="button" className="ws-earlier" aria-pressed={archived}
        onClick={() => setArchived(!archived)}>{archived ? "顯示使用中會話" : "顯示已封存會話"}</button>
      <div className="ws-session-list">
        {matching.map((session) => (
          <button type="button" className="ws-session" key={session.id} aria-current={id === session.id}
            onClick={() => onSelect(session.id)}>
            <Icon name="chat_bubble" /><span><strong>{session.title}</strong><small>{session.pinned ? "置頂 · " : ""}{session.turns.length} 張圖片
              {session.updatedAt !== undefined && <> · <time dateTime={new Date(session.updatedAt).toISOString()}>
                {new Date(session.updatedAt).toLocaleDateString("zh-TW")}
              </time></>}</small></span>
            {id === session.id && <span aria-hidden="true" className="ws-session-indicator">✓</span>}
          </button>
        ))}
        {!matching.length && <>
          <p className="ws-empty">找不到符合的會話。</p>
          {query.trim() && <button type="button" className="ws-secondary" onClick={() => {
            onQuery("");
            searchInput.current?.focus();
          }}>清除搜尋</button>}
        </>}
      </div>
    </>
  );
}
