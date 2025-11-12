import React, { useEffect, useState } from "react";

/**
 * ThemeToggle
 * - toggles document.documentElement.dataset.theme between "light" and "dark"
 * - persists choice in localStorage under key "repowriter_theme"
 * - uses theme CSS variables already present in illuvrse.css
 */

const STORAGE_KEY = "repowriter_theme";

export default function ThemeToggle(): JSX.Element {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return (localStorage.getItem(STORAGE_KEY) as "light" | "dark") || "light";
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    try {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  function toggle() {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  }

  return (
    <button
      className="btn btn-ghost btn-small"
      onClick={toggle}
      aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      style={{ display: "flex", alignItems: "center", gap: 8 }}
    >
      {theme === "light" ? "🌙 Dark" : "🌤 Light"}
    </button>
  );
}

