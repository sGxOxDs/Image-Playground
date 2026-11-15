import { useEffect, useState } from "react";
import { providerApi } from "./provider-client";
import { WorkspaceView } from "./Workspace";

export type PluginConnection = { token: string; userId: string; role: string; namespace: string; expiresAt: number; gatewayBaseUrl: string };
type Claim = { claim: string; origin: string };
type EntryState =
  | { mode: "detecting" | "pending" | "standalone" | "expired" }
  | { mode: "failed"; error: string }
  | { mode: "plugin"; connection: PluginConnection };

declare global {
  interface Window {
    imageStudioPendingClaim?: Claim;
    imageStudioStopClaimBuffer?: () => void;
  }
}

export function WorkspaceEntry({ origins, authUrl }: { origins: string[]; authUrl: string }) {
  const [state, setState] = useState<EntryState>({ mode: "detecting" });

  useEffect(() => {
    if (window.parent === window) {
      setState({ mode: "standalone" });
      return;
    }
    let alive = true;
    let active: AbortController | undefined;
    let previous: PluginConnection | undefined;
    let lastClaim = "";
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const initialTimeout = setTimeout(() => {
      if (!lastClaim) setState({ mode: "failed", error: "尚未收到 LiteLLM 身分聲明。" });
    }, 12_000);
    setState({ mode: "pending" });

    async function verify({ claim, origin }: Claim) {
      if (!origins.includes(origin) || lastClaim === claim) return;
      lastClaim = claim;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      setState((current) => current.mode === "plugin" && current.connection.expiresAt > Date.now()
        ? current : { mode: "pending" });
      try {
        const connection = await providerApi<PluginConnection>(authUrl, {
          method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ session_claim: claim, parent_origin: origin, previous_token: previous?.token }),
        });
        if (!alive || active !== controller) return;
        previous = connection;
        clearTimeout(expiryTimer);
        setState({ mode: "plugin", connection });
        expiryTimer = setTimeout(() => expire(connection.token), Math.max(0, connection.expiresAt - Date.now()));
      } catch (error) {
        if (alive && active === controller) {
          clearTimeout(expiryTimer);
          setState({ mode: "failed", error: error instanceof Error ? error.message : "無法驗證 LiteLLM 身分。" });
        }
      } finally {
        if (active === controller) {
          active = undefined;
        }
      }
    }

    function receive(event: MessageEvent) {
      if (event.source !== window.parent || event.data?.type !== "litellm-auth"
          || typeof event.data.session_claim !== "string" || event.data.session_claim.length > 8194) return;
      void verify({ claim: event.data.session_claim, origin: event.origin });
    }
    window.addEventListener("message", receive);
    window.imageStudioStopClaimBuffer?.();
    const buffered = window.imageStudioPendingClaim;
    delete window.imageStudioPendingClaim;
    delete window.imageStudioStopClaimBuffer;
    if (buffered) void verify(buffered);
    return () => {
      alive = false;
      active?.abort();
      clearTimeout(expiryTimer);
      clearTimeout(initialTimeout);
      window.removeEventListener("message", receive);
    };
  }, [origins, authUrl]);

  function expire(token: string) {
    setState((current) => current.mode === "plugin" && current.connection.token === token ? { mode: "expired" } : current);
  }

  if (state.mode === "standalone") return <WorkspaceView />;
  if (state.mode === "plugin") return <WorkspaceView key={state.connection.namespace} plugin={state.connection} />;
  const problem = state.mode === "expired" || state.mode === "failed";
  return <main className="ws-app">
    <div className="ws-empty-canvas" aria-live="polite">
      <h1>Image Studio</h1>
      <p>{state.mode === "failed" ? state.error : state.mode === "expired" ? "LiteLLM Session 已過期。"
        : state.mode === "pending" ? "正在等待 LiteLLM 身分驗證…" : "正在啟動工作台…"}</p>
      {problem && <button type="button" className="ws-primary" onClick={() => window.location.reload()}>重新連線</button>}
    </div>
  </main>;
}
