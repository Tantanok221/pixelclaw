import { ArrowUpRight, Activity, Clock3, Layers3 } from "lucide-react";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import type { AdminRunSummary, OverviewResponse } from "../../lib/monitor-client.js";
import { groupActiveRunsBySession } from "../../helpers/monitor-groups.js";
import { formatTime } from "../../helpers/monitor-format.js";
import { statusDotClassName } from "../../helpers/monitor-style.js";
import { cn } from "../../lib/utils.js";
import { OverviewMetrics } from "./overview-metrics.js";

interface ActiveSessionsHomeProps {
  overview: OverviewResponse | null;
  runs: AdminRunSummary[];
  onOpenRun: (threadId: string) => void;
}

export function ActiveSessionsHome({ overview, runs, onOpenRun }: ActiveSessionsHomeProps) {
  const sessionGroups = groupActiveRunsBySession(runs);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Overview</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight">Active Sessions</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Use this page as the primary surface for live activity. Open a run only when you need the full audit trail.
          </p>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Layers3 className="size-4" />
          <span>{sessionGroups.length} active sessions</span>
        </div>
      </div>

      <OverviewMetrics overview={overview} />

      {!sessionGroups.length ? (
        <Card className="rounded-3xl border border-border bg-card shadow-none">
          <div className="px-6 py-10 text-center">
            <Clock3 className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-4 text-sm font-medium">No active sessions</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The overview will list sessions here once a run enters `pending` or `streaming`.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {sessionGroups.map((group) => {
            const latestRun = group.runs[0] ?? null;

            return (
              <Card key={group.sessionId} className="rounded-3xl border border-border bg-card shadow-none">
                <div className="border-b border-border px-6 py-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Session</p>
                      <h3 className="mt-2 text-lg font-semibold tracking-tight">{group.sessionId}</h3>
                    </div>
                    {latestRun ? (
                      <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">
                        Updated {formatTime(latestRun.latestEventAt)}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3 px-6 py-5">
                  {group.runs.map((run) => (
                    <div
                      key={run.id}
                      className="rounded-2xl border border-border bg-background px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn("size-2 rounded-full", statusDotClassName(run.status))} />
                            <p className="text-sm font-medium">{run.threadTitle}</p>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">
                            {run.preview || "Waiting for output."}
                          </p>
                          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="rounded-full border border-border px-2.5 py-1">{run.source}</span>
                            <span>{run.latestEventType ?? "pending"}</span>
                          </div>
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => {
                            onOpenRun(run.threadId);
                          }}
                        >
                          Open
                          <ArrowUpRight className="size-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Card className="rounded-3xl border border-border bg-card shadow-none">
        <div className="flex items-start gap-3 px-6 py-5">
          <Activity className="mt-0.5 size-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Recent runs remain in the sidebar</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              The left rail is now a slimmer drill-down surface. The default page stays focused on currently active sessions.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
