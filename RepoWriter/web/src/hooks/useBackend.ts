import { useEffect, useState, useCallback } from "react";

export type Backend = "openai" | "local";

const LS_KEYS = {
  backend: "repowriter_backend",
  openaiKey: "repowriter_openai_key",
  openaiModel: "repowriter_openai_model",
  localUrl: "repowriter_local_url",
  localModel: "repowriter_local_model"
};

export type Settings = {
  backend: Backend;
  openaiKey: string | null;
  openaiModel: string;
  localUrl: string;
  localModel: string;
};

/**
 * Read settings from localStorage with sensible defaults.
 */
function readSettings(): Settings {
  const backend = (localStorage.getItem(LS_KEYS.backend) as Backend) || "openai";
  const openaiKey = localStorage.getItem(LS_KEYS.openaiKey) || "";
  const openaiModel = localStorage.getItem(LS_KEYS.openaiModel) || "gpt-4o-mini";
  const localUrl = localStorage.getItem(LS_KEYS.localUrl) || "http://127.0.0.1:7860";
  const localModel = localStorage.getItem(LS_KEYS.localModel) || "local-gpt";
  return {
    backend,
    openaiKey: openaiKey || null,
    openaiModel,
    localUrl,
    localModel
  };
}

/**
 * Persist settings to localStorage and emit a global event so other parts of the app can react.
 */
function persistSettings(s: Settings) {
  localStorage.setItem(LS_KEYS.backend, s.backend);
  localStorage.setItem(LS_KEYS.openaiKey, s.openaiKey ?? "");
  localStorage.setItem(LS_KEYS.openaiModel, s.openaiModel);
  localStorage.setItem(LS_KEYS.localUrl, s.localUrl);
  localStorage.setItem(LS_KEYS.localModel, s.localModel);

  window.dispatchEvent(new CustomEvent("repowriter:settingsChanged", { detail: s }));
}

/**
 * useBackend
 *
 * Hook that exposes current backend selection and settings, and setters to update them.
 * It also listens for `repowriter:settingsChanged` events to stay in sync if some other
 * component updates settings.
 */
export default function useBackend() {
  const [settings, setSettings] = useState<Settings>(() => readSettings());

  // Sync to localStorage when settings change
  useEffect(() => {
    persistSettings(settings);
  }, [settings]);

  // Listen to external changes from SettingsDrawer which also emits repowriter:settingsChanged
  useEffect(() => {
    function handler(e: any) {
      try {
        const d = e?.detail;
        if (!d) return;
        // merge with existing but favor event detail
        const merged: Settings = {
          backend: d.backend ?? settings.backend,
          openaiKey: d.openaiKey ?? settings.openaiKey,
          openaiModel: d.openaiModel ?? settings.openaiModel,
          localUrl: d.localUrl ?? settings.localUrl,
          localModel: d.localModel ?? settings.localModel
        };
        setSettings(merged);
      } catch {
        // ignore malformed events
      }
    }
    window.addEventListener("repowriter:settingsChanged", handler as EventListener);
    return () => window.removeEventListener("repowriter:settingsChanged", handler as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setBackend = useCallback((backend: Backend) => {
    setSettings((s) => {
      const next: Settings = { ...s, backend };
      persistSettings(next);
      return next;
    });
  }, []);

  const setOpenAIKey = useCallback((key: string | null) => {
    setSettings((s) => {
      const next = { ...s, openaiKey: key };
      persistSettings(next);
      return next;
    });
  }, []);

  const setOpenAIModel = useCallback((model: string) => {
    setSettings((s) => {
      const next = { ...s, openaiModel: model };
      persistSettings(next);
      return next;
    });
  }, []);

  const setLocalUrl = useCallback((url: string) => {
    setSettings((s) => {
      const next = { ...s, localUrl: url };
      persistSettings(next);
      return next;
    });
  }, []);

  const setLocalModel = useCallback((m: string) => {
    setSettings((s) => {
      const next = { ...s, localModel: m };
      persistSettings(next);
      return next;
    });
  }, []);

  const isOpenAI = settings.backend === "openai";
  const isLocal = settings.backend === "local";

  return {
    settings,
    setSettings, // direct setter if needed
    setBackend,
    setOpenAIKey,
    setOpenAIModel,
    setLocalUrl,
    setLocalModel,
    isOpenAI,
    isLocal
  };
}

