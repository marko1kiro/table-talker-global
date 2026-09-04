/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from "react";

export type Theme = "dark" | "light";
export const THEME_STORAGE_KEY = "ta-theme";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readStoredTheme(storage: StorageLike | null): Theme {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function writeStoredTheme(storage: StorageLike | null, theme: Theme): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode / quota: keep in-memory only */
  }
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export type ThemeValue = { isDark: boolean; toggle: () => void };

export function useTheme(): ThemeValue {
  const [isDark, setIsDark] = useState(() => readStoredTheme(browserStorage()) === "dark");
  const toggle = () =>
    setIsDark((d) => {
      const next = !d;
      writeStoredTheme(browserStorage(), next ? "dark" : "light");
      return next;
    });
  return { isDark, toggle };
}

export const ThemeContext = createContext<ThemeValue | null>(null);

export function useThemeValue(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeValue must be used within AppShell ThemeContext");
  return ctx;
}
