import { createContext, useContext } from "react";
import type { useMonitorDashboard } from "../hooks/use-monitor-dashboard.js";
import type { MonitorTheme } from "../hooks/use-monitor-theme.js";

export interface MonitorAppContextValue {
  dashboard: ReturnType<typeof useMonitorDashboard>;
  theme: MonitorTheme;
  onToggleTheme: () => void;
}

const MonitorAppContext = createContext<MonitorAppContextValue | null>(null);

export const MonitorAppProvider = MonitorAppContext.Provider;

export function useMonitorAppContext() {
  const context = useContext(MonitorAppContext);

  if (!context) {
    throw new Error("Monitor app context is unavailable.");
  }

  return context;
}
