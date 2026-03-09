import { useEffect, useState } from "react";
import { ChevronRight, Home, PanelLeft, RefreshCw } from "lucide-react";
import { Button } from "../ui/button.js";
import { Card } from "../ui/card.js";
import { ScrollArea } from "../ui/scroll-area.js";
import type { AdminRunSummary } from "../../lib/monitor-client.js";
import { cn } from "../../lib/utils.js";
import { runBadgeClassName, runMetaClassName, statusDotClassName } from "../../helpers/monitor-style.js";
import { ThemeToggle } from "./theme-toggle.js";
import type { MonitorTheme } from "../../hooks/use-monitor-theme.js";

const DEFAULT_VISIBLE_RUNS = 10;

interface DashboardSidebarProps {
  isBootstrapping: boolean;
  isRefreshing: boolean;
  isShowingOverview: boolean;
  theme: MonitorTheme;
  runs: AdminRunSummary[];
  selectedRunId: string | null;
  onOpenOverview: () => void;
  onRefresh: () => void;
  onSelectRun: (threadId: string) => void;
  onToggleTheme: () => void;
}

export function DashboardSidebar({
  isBootstrapping,
  isRefreshing,
  isShowingOverview,
  theme,
  runs,
  selectedRunId,
  onOpenOverview,
  onRefresh,
  onSelectRun,
  onToggleTheme,
}: DashboardSidebarProps) {
  const [isShowingAllRuns, setIsShowingAllRuns] = useState(false);
  const visibleRuns = isShowingAllRuns ? runs : runs.slice(0, DEFAULT_VISIBLE_RUNS);
  const hasHiddenRuns = runs.length > DEFAULT_VISIBLE_RUNS;

  useEffect(() => {
    if (!hasHiddenRuns && isShowingAllRuns) {
      setIsShowingAllRuns(false);
    }
  }, [hasHiddenRuns, isShowingAllRuns]);

  useEffect(() => {
    const selectedRunIndex = runs.findIndex((run) => run.id === selectedRunId);
    if (selectedRunIndex >= DEFAULT_VISIBLE_RUNS) {
      setIsShowingAllRuns(true);
    }
  }, [runs, selectedRunId]);

  return (
    <aside className="border-b border-border bg-sidebar xl:border-b-0 xl:border-r">
      <div className="flex h-full flex-col">
        <div className="border-b border-sidebar-border px-3 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <PanelLeft className="size-3.5" />
                <span>Monitor</span>
              </div>
              <h1 className="mt-2 text-sm font-semibold tracking-tight">Operations Monitor</h1>
            </div>

            <div className="flex items-center gap-2">
              <ThemeToggle theme={theme} onToggle={onToggleTheme} />
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-2 px-2.5"
                onClick={onRefresh}
                disabled={isRefreshing}
                aria-label="Refresh dashboard"
              >
                <RefreshCw className={cn("size-4", isRefreshing ? "animate-spin" : "")} />
                <span className="sr-only">Refresh dashboard</span>
              </Button>
            </div>
          </div>
        </div>

        <ScrollArea className="flex-1 px-3 py-3">
          <div className="mb-2">
            <Button
              variant={isShowingOverview ? "default" : "outline"}
              className="h-9 w-full justify-start gap-2 rounded-xl"
              onClick={onOpenOverview}
            >
              <Home className="size-4" />
              Overview
            </Button>
          </div>

          <div className="mb-3 mt-4 flex items-center justify-between px-1">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recent runs</p>
            <span className="text-xs text-muted-foreground">{runs.length} total</span>
          </div>

          <div className="space-y-2">
            {visibleRuns.map((run) => {
              const isSelected = selectedRunId === run.id;

              return (
                <button
                  key={run.id}
                  type="button"
                  className={cn(
                    "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                    isSelected
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-card hover:border-foreground/30 hover:bg-muted/60",
                  )}
                  onClick={() => {
                    onSelectRun(run.threadId);
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={cn("size-2 rounded-full", statusDotClassName(run.status))} />
                        <span className="text-sm font-medium">{run.threadTitle}</span>
                      </div>
                      <p
                        className={cn(
                          "mt-1 line-clamp-1 text-xs leading-5",
                          isSelected ? "text-background/70" : "text-muted-foreground",
                        )}
                      >
                        {run.preview || "No final preview yet."}
                      </p>
                    </div>
                    <ChevronRight
                      className={cn(
                        "mt-1 size-4 shrink-0",
                        isSelected ? "text-background/60" : "text-muted-foreground",
                      )}
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-[0.14em]">
                    <span className={runBadgeClassName(isSelected)}>{run.status}</span>
                    <span className={runMetaClassName(isSelected)}>{run.source}</span>
                    <span className={runMetaClassName(isSelected)}>{run.latestEventType ?? "pending"}</span>
                  </div>
                </button>
              );
            })}

            {hasHiddenRuns ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full rounded-xl"
                onClick={() => {
                  setIsShowingAllRuns(true);
                }}
                disabled={isShowingAllRuns}
              >
                {isShowingAllRuns ? `Showing all ${runs.length} runs` : `Show more (${runs.length - visibleRuns.length})`}
              </Button>
            ) : null}

            {!runs.length && !isBootstrapping ? (
              <Card className="rounded-xl border-dashed border-border bg-card px-4 py-6 shadow-none">
                <p className="text-sm font-medium">No runs yet</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Once the server starts processing prompts, recent runs and audit events will show up here.
                </p>
              </Card>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </aside>
  );
}
