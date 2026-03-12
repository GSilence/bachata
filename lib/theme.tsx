"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type ThemeName = "default" | "purple-night";

interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "purple-night",
  setTheme: () => {},
});

const STORAGE_KEY = "bachata-theme";

export function ThemeProvider({
  children,
  defaultTheme = "purple-night",
}: {
  children: React.ReactNode;
  defaultTheme?: ThemeName;
}) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    // SSR-safe: on client, read what the inline script already applied
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-theme") as ThemeName | null;
      if (attr === "default" || attr === "purple-night") return attr;
    }
    return defaultTheme;
  });

  // Sync state with localStorage on mount (covers edge cases)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
      if (saved && (saved === "default" || saved === "purple-night")) {
        setThemeState(saved);
        document.documentElement.setAttribute("data-theme", saved);
      }
    } catch {}
  }, []);

  const setTheme = useCallback((newTheme: ThemeName) => {
    setThemeState(newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
