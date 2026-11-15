import { useEffect, useState } from "react";

const appearanceKey = "image-studio-appearance";
const appearanceLabel = { system: "跟隨系統", light: "淺色", dark: "深色" } as const;
type Appearance = keyof typeof appearanceLabel;

function readAppearance(value: string | null | undefined): Appearance {
  return value === "light" || value === "dark" ? value : "system";
}

export const appearanceBootstrap = `(() => {
  try {
    const value = localStorage.getItem(${JSON.stringify(appearanceKey)});
    if (value === "light" || value === "dark") document.documentElement.dataset.appearance = value;
  } catch {}
  const dark = document.documentElement.dataset.appearance === "dark" ||
    (!document.documentElement.dataset.appearance && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#18181b" : "#f4f4f5");
})();`;

function applyAppearance(appearance: Appearance, systemDark: boolean) {
  if (appearance === "system") delete document.documentElement.dataset.appearance;
  else document.documentElement.dataset.appearance = appearance;
  const dark = appearance === "dark" || appearance === "system" && systemDark;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#18181b" : "#f4f4f5");
}

export function useAppearanceChrome() {
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    function onSystem() {
      applyAppearance(readAppearance(document.documentElement.dataset.appearance), system.matches);
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== appearanceKey && event.key !== null) return;
      applyAppearance(readAppearance(event.newValue), system.matches);
    }
    system.addEventListener("change", onSystem);
    window.addEventListener("storage", onStorage);
    return () => {
      system.removeEventListener("change", onSystem);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
}

export function AppearanceSettings() {
  const [appearance, setAppearance] = useState<Appearance>("system");

  useEffect(() => {
    setAppearance(readAppearance(document.documentElement.dataset.appearance));
    function onStorage(event: StorageEvent) {
      if (event.key === appearanceKey || event.key === null) setAppearance(readAppearance(event.newValue));
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return <label className="ws-field">外觀<select value={appearance} onChange={(event) => {
    const next = readAppearance(event.target.value);
    setAppearance(next);
    applyAppearance(next, matchMedia("(prefers-color-scheme: dark)").matches);
    try {
      if (next === "system") localStorage.removeItem(appearanceKey);
      else localStorage.setItem(appearanceKey, next);
    } catch {
      // Browsers can restrict storage in embedded contexts. The current page still keeps the selection.
    }
  }}>
    {Object.entries(appearanceLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
  </select></label>;
}
