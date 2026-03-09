import { useLayoutEffect, useState } from "react";

export type MonitorTheme = "dark" | "light";

const STORAGE_KEY = "monitor-theme";

function resolveInitialTheme(): MonitorTheme {
  if (typeof window === "undefined") {
    return "dark";
  }

  const storedTheme = window.localStorage.getItem(STORAGE_KEY);
  return storedTheme === "light" ? "light" : "dark";
}

export function useMonitorTheme() {
  const [theme, setTheme] = useState<MonitorTheme>(resolveInitialTheme);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  return {
    theme,
    setTheme,
    toggleTheme: () => {
      setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
    },
  };
}
