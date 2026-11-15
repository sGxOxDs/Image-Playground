import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<{ outcome: "accepted" | "dismissed" }> };

export function useStandaloneApp(standalone: boolean) {
  const [online, setOnline] = useState(true);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt>();

  useEffect(() => {
    function updateConnection() { setOnline(navigator.onLine); }
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (!standalone || !import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const installed = () => setInstallPrompt(undefined);
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    void navigator.serviceWorker.register("./sw.js").catch((error: unknown) => {
      console.error("Service worker registration failed:", error);
    });
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", installed);
    };
  }, [standalone]);

  async function install() {
    if (!installPrompt) return;
    setInstallPrompt(undefined);
    await installPrompt.prompt().catch(() => undefined);
  }

  return { online, canInstall: Boolean(installPrompt), install };
}
