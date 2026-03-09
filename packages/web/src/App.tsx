import { useMemo, useState } from "react";
import { useMonitorDashboard } from "./hooks/use-monitor-dashboard.js";
import { useMonitorTheme } from "./hooks/use-monitor-theme.js";
import { createMonitorClient, type MonitorClient } from "./lib/monitor-client.js";
import { MonitorAppProvider } from "./context/monitor-app-context.js";
import { createMonitorRouter, MonitorRouterProvider } from "./router.js";

export interface AppProps {
  client?: MonitorClient;
}

export function App({ client }: AppProps) {
  const [resolvedClient] = useState(() => client ?? createMonitorClient());
  const themeState = useMonitorTheme();
  const dashboard = useMonitorDashboard(resolvedClient);
  const [router] = useState(() => createMonitorRouter());
  const routerContext = useMemo(
    () => ({
      dashboard,
      theme: themeState.theme,
      onToggleTheme: themeState.toggleTheme,
    }),
    [dashboard, themeState.theme, themeState.toggleTheme],
  );

  return (
    <MonitorAppProvider value={routerContext}>
      <MonitorRouterProvider router={router} />
    </MonitorAppProvider>
  );
}

export default App;
