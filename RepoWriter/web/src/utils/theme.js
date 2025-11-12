/**
 * theme.ts
 *
 * Tiny theme helper for the ILLUVRSE Codex UI.
 * - Persists theme in localStorage under key `repowriter_theme`
 * - Applies `data-theme` attribute to document.documentElement ("dark" | "light")
 * - Exports: getTheme(), setTheme(), toggleTheme(), useTheme() React hook
 *
 * Usage:
 *  import { setTheme, getTheme, toggleTheme, useTheme } from "../utils/theme";
 *  setTheme("dark");
 *  const [theme, setTheme] = useTheme();
 */
import { useEffect, useState } from "react";
const LS_KEY = "repowriter_theme";
/** Read persisted theme or fallback to "dark" */
export function getTheme() {
    const v = (localStorage.getItem(LS_KEY) || "dark");
    return v === "light" ? "light" : "dark";
}
/** Apply theme to document and persist */
export function setTheme(theme) {
    try {
        localStorage.setItem(LS_KEY, theme);
    }
    catch {
        // ignore storage errors
    }
    try {
        document.documentElement.setAttribute("data-theme", theme);
    }
    catch {
        // ignore
    }
    // Broadcast event so other parts can react
    try {
        window.dispatchEvent(new CustomEvent("repowriter:themeChanged", { detail: { theme } }));
    }
    catch { }
}
/** Toggle between dark and light */
export function toggleTheme() {
    const next = getTheme() === "dark" ? "light" : "dark";
    setTheme(next);
    return next;
}
/**
 * React hook to access and set theme.
 * Keeps component state in sync with localStorage and global events.
 */
export function useTheme() {
    const [theme, setThemeState] = useState(() => getTheme());
    useEffect(() => {
        // Apply on mount
        setTheme(theme);
        // Listen for external changes
        function onTheme(e) {
            const t = e?.detail?.theme;
            if (t === "light" || t === "dark")
                setThemeState(t);
        }
        window.addEventListener("repowriter:themeChanged", onTheme);
        return () => window.removeEventListener("repowriter:themeChanged", onTheme);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const setThemeAndState = (t) => {
        setThemeState(t);
        setTheme(t);
    };
    const toggle = () => {
        const next = toggleTheme();
        setThemeState(next);
    };
    return [theme, setThemeAndState, toggle];
}
