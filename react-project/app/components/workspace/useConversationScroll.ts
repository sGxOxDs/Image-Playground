import { useCallback, useLayoutEffect, useRef, useState } from "react";

const nearEnd = (element: HTMLElement) => element.scrollHeight - element.scrollTop - element.clientHeight <= 48;

export function useConversationScroll(sessionId: string, latestId: string | undefined, expanded: boolean) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const atEnd = useRef(true);
  const ref = useCallback((messages: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    messagesRef.current = messages;
    if (!messages) return;
    observer.current = new ResizeObserver(() => {
      if (atEnd.current) messages.scrollTop = messages.scrollHeight;
    });
    observer.current.observe(messages);
  }, []);
  const [seen, setSeen] = useState({ sessionId, id: latestId });
  const sameSession = seen.sessionId === sessionId;
  const hasNewResult = sameSession && seen.id !== latestId && latestId !== undefined;
  const visibleId = hasNewResult && !expanded ? seen.id : latestId;
  const scrollToEnd = () => {
    const messages = messagesRef.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  };

  useLayoutEffect(() => {
    if (!sameSession || !latestId) atEnd.current = true;
    if (!atEnd.current) return;
    if (!sameSession || seen.id !== latestId) {
      setSeen({ sessionId, id: latestId });
      return;
    }
    scrollToEnd();
  }, [sessionId, latestId, sameSession, seen.id]);

  function followLatest() {
    atEnd.current = true;
    if (hasNewResult) setSeen({ sessionId, id: latestId });
    else scrollToEnd();
  }

  function onScroll() {
    const messages = messagesRef.current;
    if (!messages) return;
    atEnd.current = nearEnd(messages);
    if (atEnd.current && hasNewResult) followLatest();
  }

  function readEarlier() {
    atEnd.current = false;
    if (messagesRef.current) messagesRef.current.scrollTop = 0;
  }

  return { ref, hasNewResult, visibleId, followLatest, onScroll, readEarlier };
}
