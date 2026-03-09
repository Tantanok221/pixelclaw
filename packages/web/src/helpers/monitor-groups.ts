import type { AdminRunSummary } from "../lib/monitor-client.js";

export interface SessionRunGroup {
  sessionId: string;
  runs: AdminRunSummary[];
}

export function groupActiveRunsBySession(runs: AdminRunSummary[]): SessionRunGroup[] {
  const activeRuns = runs.filter((run) => run.status === "pending" || run.status === "streaming");
  const groups = new Map<string, AdminRunSummary[]>();

  for (const run of activeRuns) {
    const sessionRuns = groups.get(run.sessionId) ?? [];
    sessionRuns.push(run);
    groups.set(run.sessionId, sessionRuns);
  }

  return Array.from(groups.entries())
    .map(([sessionId, sessionRuns]) => ({
      sessionId,
      runs: sessionRuns.sort((left, right) => right.latestEventAt.localeCompare(left.latestEventAt)),
    }))
    .sort((left, right) => {
      const leftLatest = left.runs[0]?.latestEventAt ?? "";
      const rightLatest = right.runs[0]?.latestEventAt ?? "";
      return rightLatest.localeCompare(leftLatest);
    });
}
