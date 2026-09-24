"use client";

import { useCallback, useEffect, useState } from "react";

export type TerminalTheme = "light" | "dark";

const THEME_KEY = "bullcase-theme-premium";

export function readSavedTheme(getStorage: () => Pick<Storage, "getItem"> = () => window.localStorage): TerminalTheme {
  try {
    return getStorage().getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function persistTheme(theme: TerminalTheme, getStorage: () => Pick<Storage, "setItem"> = () => window.localStorage): void {
  try {
    getStorage().setItem(THEME_KEY, theme);
  } catch {
    // A device preference must not prevent using the current session.
  }
}

export function useTerminalTheme() {
  const [theme, setTheme] = useState<TerminalTheme>("dark");

  useEffect(() => {
    setTheme(readSavedTheme());
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      persistTheme(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme };
}
