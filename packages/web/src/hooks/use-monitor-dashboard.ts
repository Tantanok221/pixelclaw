import { useCallback, useEffect, useState } from "react";
import type {
  AdminRunDetail,
  AdminRunEvent,
  AdminRunSummary,
  GithubAccount,
  MonitorSummary,
  MonitorNotification,
  MonitorClient,
  OverviewResponse,
} from "../lib/monitor-client.js";
import type { InspectorTab } from "../components/monitor/types.js";

export function useMonitorDashboard(client: MonitorClient) {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [runs, setRuns] = useState<AdminRunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<AdminRunDetail | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<AdminRunEvent[]>([]);
  const [githubAccounts, setGithubAccounts] = useState<GithubAccount[]>([]);
  const [monitors, setMonitors] = useState<MonitorSummary[]>([]);
  const [notifications, setNotifications] = useState<MonitorNotification[]>([]);
  const [selectedTab, setSelectedTab] = useState<InspectorTab>("timeline");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [nextOverview, nextRuns, nextNotifications, nextGithubAccounts, nextMonitors] = await Promise.all([
          client.getOverview(),
          client.listRuns(),
          client.getNotifications(),
          client.getGithubAccounts(),
          client.getMonitors(),
        ]);

        if (cancelled) {
          return;
        }

        setOverview(nextOverview);
        setRuns(nextRuns);
        setNotifications(normalizeNotifications(nextNotifications));
        setGithubAccounts(nextGithubAccounts);
        setMonitors(nextMonitors);

        setSelectedRunId(null);
        setSelectedRun(null);
        setSelectedEvents([]);
        setError(null);
      } catch (loadError: unknown) {
        if (cancelled) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Unable to load monitor dashboard.");
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    return client.subscribeToNotifications((notification) => {
      setNotifications((current) => normalizeNotifications([notification, ...current]));
    });
  }, [client]);

  const refreshDashboard = async () => {
    setIsRefreshing(true);

    try {
      const [nextOverview, nextRuns, nextNotifications, nextGithubAccounts, nextMonitors] = await Promise.all([
        client.getOverview(),
        client.listRuns(),
        client.getNotifications(),
        client.getGithubAccounts(),
        client.getMonitors(),
      ]);

      setOverview(nextOverview);
      setRuns(nextRuns);
      setNotifications(normalizeNotifications(nextNotifications));
      setGithubAccounts(nextGithubAccounts);
      setMonitors(nextMonitors);

      const nextSelectedRunId = selectedRunId
        ? nextRuns.find((run) => run.id === selectedRunId)?.id ?? null
        : null;
      setSelectedRunId(nextSelectedRunId);

      if (!nextSelectedRunId) {
        setSelectedRun(null);
        setSelectedEvents([]);
        setError(null);
        return;
      }

      const { detail, events } = await loadRunInspection(client, nextSelectedRunId);
      setSelectedRun(detail);
      setSelectedEvents(events);
      setError(null);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Unable to refresh monitor dashboard.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const selectRun = async (runId: string) => {
    setSelectedRunId(runId);
    setSelectedTab("timeline");
    setIsRefreshing(true);

    try {
      const { detail, events } = await loadRunInspection(client, runId);
      setSelectedRun(detail);
      setSelectedEvents(events);
      setError(null);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Unable to inspect run.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const goToOverview = () => {
    setSelectedRunId(null);
    setSelectedRun(null);
    setSelectedEvents([]);
    setSelectedTab("timeline");
    setError(null);
  };

  const selectedSummary = runs.find((run) => run.id === selectedRunId) ?? null;

  const createMonitor = async (input: {
    githubAccountId: string;
    repository: string;
  }) => {
    const monitor = await client.createMonitor(input);
    setMonitors((current) => [monitor, ...current.filter((item) => item.id !== monitor.id)]);
    return monitor;
  };

  const listGithubRepositories = useCallback(
    async (githubAccountId: string) => client.getGithubRepositories(githubAccountId),
    [client],
  );

  const syncGithubAccounts = async () => {
    const accounts = await client.syncGithubAccounts();
    setGithubAccounts(accounts);
    setError(null);
    return accounts;
  };

  return {
    error,
    githubAccounts,
    isBootstrapping,
    isRefreshing,
    listGithubRepositories,
    monitors,
    overview,
    notifications,
    createMonitor,
    syncGithubAccounts,
    refreshDashboard,
    runs,
    selectedEvents,
    selectedRun,
    selectedRunId,
    selectedSummary,
    selectedTab,
    selectRun,
    goToOverview,
    setSelectedTab,
  };
}

async function loadRunInspection(client: MonitorClient, runId: string) {
  const [detail, events] = await Promise.all([client.getRun(runId), client.getRunEvents(runId)]);

  return {
    detail,
    events: events.events,
  };
}

function normalizeNotifications(notifications: MonitorNotification[]) {
  const seen = new Set<string>();
  const unique: MonitorNotification[] = [];

  for (const notification of notifications) {
    if (seen.has(notification.id)) {
      continue;
    }

    seen.add(notification.id);
    unique.push({ ...notification, payload: { ...notification.payload } });
  }

  return unique.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
