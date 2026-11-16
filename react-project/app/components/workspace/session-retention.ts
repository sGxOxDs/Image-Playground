import { cleanUnusedAssets, workspacePictures } from "./backup";
import type { Workspace } from "./model";

export const defaultRetentionDays = 30;
export const legacyBuiltInSessionIds: ReadonlySet<string> = new Set(["shinjuku", "product", "portfolio"]);

export function retireBuiltInSessions(workspace: Workspace) {
  const ids = new Set(workspace.sessions.filter(({ id }) => legacyBuiltInSessionIds.has(id)).map(({ id }) => id));
  return removeSessions(workspace, ids);
}

export function removeSessions(workspace: Workspace, ids: ReadonlySet<string>, now = Date.now()): Workspace {
  if (!ids.size) return workspace;
  const removed = workspace.sessions.filter(({ id }) => ids.has(id));
  const removedPictures = new Set(workspacePictures({
    ...workspace, sessions: removed, assets: [],
    drafts: Object.fromEntries(Object.entries(workspace.drafts).filter(([id]) => ids.has(id))),
    jobs: workspace.jobs?.filter(({ sessionId }) => ids.has(sessionId)),
  }).map(({ id }) => id));
  let sessions = workspace.sessions.filter(({ id }) => !ids.has(id));
  if (!sessions.length) sessions = [{ id: crypto.randomUUID(), title: "新會話", turns: [],
    createdAt: now, profileId: workspace.lastProfileId ?? undefined }];
  const survivingResults = new Set(sessions.flatMap(({ turns }) => turns.map(({ image }) => image.id)));
  const assets = workspacePictures(workspace).filter(({ id }) => !survivingResults.has(id));
  const next = { ...workspace, sessions, assets,
    drafts: Object.fromEntries(Object.entries(workspace.drafts).filter(([id]) => !ids.has(id))),
    jobs: workspace.jobs?.filter(({ sessionId }) => !ids.has(sessionId)),
    activeId: sessions.some(({ id }) => id === workspace.activeId) ? workspace.activeId
      : (sessions.find(({ archived }) => !archived) ?? sessions[0]).id,
  };
  const independent = new Set(workspace.assets?.filter(({ id }) => !removedPictures.has(id)).map(({ id }) => id));
  const inUse = new Set(cleanUnusedAssets(next).map(({ id }) => id));
  return { ...next, assets: assets.filter(({ id }) => independent.has(id) || inUse.has(id)) };
}

export function pruneExpiredSessions(workspace: Workspace, now = Date.now()) {
  const days = workspace.retentionDays ?? defaultRetentionDays;
  if (days === 0) return workspace;
  const cutoff = now - days * 86_400_000;
  const busy = new Set(workspace.jobs?.filter(({ status }) => status === "running" || status === "queued")
    .map(({ sessionId }) => sessionId));
  const expired = new Set(workspace.sessions.filter((session) => {
    const lastTurn = session.turns.reduce((latest, turn) => Math.max(latest, turn.createdAt ?? 0), 0);
    const lastActivity = lastTurn || (session.turns.length ? session.updatedAt ?? session.createdAt : session.createdAt);
    return !busy.has(session.id) && typeof lastActivity === "number" && lastActivity <= cutoff;
  }).map(({ id }) => id));
  return removeSessions(workspace, expired, now);
}
