import { Activity, AlertCircle, ScanSearch, Workflow } from "lucide-react";
import { Card } from "../ui/card.js";
import type { OverviewResponse } from "../../lib/monitor-client.js";

interface OverviewMetricsProps {
  overview: OverviewResponse | null;
}

export function OverviewMetrics({ overview }: OverviewMetricsProps) {
  const metricCards = [
    {
      label: "Active runs",
      value: overview?.counts.activeRuns ?? 0,
      icon: Activity,
    },
    {
      label: "Failures (24h)",
      value: overview?.counts.failedRunsLast24Hours ?? 0,
      icon: AlertCircle,
    },
    {
      label: "Runs (24h)",
      value: overview?.counts.runsLast24Hours ?? 0,
      icon: ScanSearch,
    },
    {
      label: "Active sessions",
      value: overview?.counts.activeSessions ?? 0,
      icon: Workflow,
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {metricCards.map((metric) => (
        <Card key={metric.label} className="rounded-2xl border border-border bg-card px-4 py-4 shadow-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{metric.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight">{metric.value}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-2">
              <metric.icon className="size-4 text-muted-foreground" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
