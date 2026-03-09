import { Outlet, RouterProvider, createRootRoute, createRoute, createRouter, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ActiveSessionsHome } from "./components/monitor/active-sessions-home.js";
import { DashboardSidebar } from "./components/monitor/dashboard-sidebar.js";
import { InspectorHeader } from "./components/monitor/inspector-header.js";
import { InspectorStateCard } from "./components/monitor/inspector-state-card.js";
import { RunInspector } from "./components/monitor/run-inspector.js";
import { Card } from "./components/ui/card.js";
import type { AdminRunSummary } from "./lib/monitor-client.js";
import { useMonitorAppContext } from "./context/monitor-app-context.js";

const rootRoute = createRootRoute({
  component: MonitorLayout,
});

const overviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewRoute,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chats/$threadId",
  component: ChatRoute,
});

const routeTree = rootRoute.addChildren([overviewRoute, chatRoute]);

export function createMonitorRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
  });
}

export function MonitorRouterProvider({ router }: { router: ReturnType<typeof createMonitorRouter> }) {
  return <RouterProvider router={router} />;
}

function MonitorLayout() {
  const navigate = useNavigate();
  const { dashboard, theme, onToggleTheme } = useMonitorAppContext();
  const {
    error,
    isRefreshing,
    overview,
    refreshDashboard,
    runs,
    selectedRun,
    selectedRunId,
    selectedSummary,
  } = dashboard;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="min-h-screen">
        <div className="grid min-h-screen xl:grid-cols-[248px_minmax(0,1fr)]">
          <DashboardSidebar
            isBootstrapping={dashboard.isBootstrapping}
            isRefreshing={isRefreshing}
            isShowingOverview={!selectedRun}
            theme={theme}
            runs={runs}
            selectedRunId={selectedRunId}
            onOpenOverview={() => {
              dashboard.goToOverview();
              void navigate({ to: "/" });
            }}
            onRefresh={() => {
              void refreshDashboard();
            }}
            onSelectRun={(threadId) => {
              void navigate({
                to: "/chats/$threadId",
                params: { threadId },
              });
            }}
            onToggleTheme={onToggleTheme}
          />

          <main className="flex min-h-screen flex-col">
            <InspectorHeader selectedRun={selectedRun} selectedSummary={selectedSummary} />

            <div className="flex-1 bg-background px-6 py-6 lg:px-8">
              {error ? (
                <Card className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive shadow-none">
                  {error}
                </Card>
              ) : null}

              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function OverviewRoute() {
  const navigate = useNavigate();
  const { dashboard } = useMonitorAppContext();

  useEffect(() => {
    if (dashboard.selectedRunId) {
      dashboard.goToOverview();
    }
  }, [dashboard]);

  if (dashboard.isBootstrapping) {
    return (
      <InspectorStateCard
        title="Loading system snapshot"
        description="Pulling current overview, runs, and the latest audit trail."
        withIcon
      />
    );
  }

  return (
    <ActiveSessionsHome
      overview={dashboard.overview}
      runs={dashboard.runs}
      onOpenRun={(threadId) => {
        void navigate({
          to: "/chats/$threadId",
          params: { threadId },
        });
      }}
    />
  );
}

function ChatRoute() {
  const { threadId } = chatRoute.useParams();
  const { dashboard } = useMonitorAppContext();
  const matchingRun = dashboard.runs.find((run: AdminRunSummary) => run.threadId === threadId) ?? null;

  useEffect(() => {
    if (matchingRun && dashboard.selectedRunId !== matchingRun.id) {
      void dashboard.selectRun(matchingRun.id);
    }
  }, [dashboard, matchingRun]);

  if (dashboard.isBootstrapping || (matchingRun && dashboard.selectedRunId !== matchingRun.id)) {
    return (
      <InspectorStateCard
        title="Loading chat audit"
        description="Pulling the latest run state, transcript, and timeline for this chat."
        withIcon
      />
    );
  }

  if (!matchingRun) {
    return (
      <InspectorStateCard
        title="Chat not found"
        description="This chat does not have any recent runs in the current dashboard snapshot."
      />
    );
  }

  if (!dashboard.selectedRun || dashboard.selectedRun.run.threadId !== threadId) {
    return (
      <InspectorStateCard
        title="Loading chat audit"
        description="Pulling the latest run state, transcript, and timeline for this chat."
        withIcon
      />
    );
  }

  return (
    <RunInspector
      onTabChange={dashboard.setSelectedTab}
      selectedEvents={dashboard.selectedEvents}
      selectedRun={dashboard.selectedRun}
      selectedSummary={dashboard.selectedSummary}
      selectedTab={dashboard.selectedTab}
    />
  );
}
