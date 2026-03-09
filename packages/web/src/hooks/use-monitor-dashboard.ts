import { useEffect, useState } from "react";
import type {
  AdminRunDetail,
  AdminRunEvent,
  AdminRunSummary,
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
  const [selectedTab, setSelectedTab] = useState<InspectorTab>("timeline");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const [nextOverview, nextRuns] = await Promise.all([client.getOverview(), client.listRuns()]);

        if (cancelled) {
          return;
        }

        setOverview(nextOverview);
        setRuns(nextRuns);

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

  const refreshDashboard = async () => {
    setIsRefreshing(true);

    try {
      const [nextOverview, nextRuns] = await Promise.all([client.getOverview(), client.listRuns()]);

      setOverview(nextOverview);
      setRuns(nextRuns);

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

  return {
    error,
    isBootstrapping,
    isRefreshing,
    overview,
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
