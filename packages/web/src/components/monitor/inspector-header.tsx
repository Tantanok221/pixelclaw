import type { AdminRunDetail, AdminRunSummary } from "../../lib/monitor-client.js";
import { formatTime } from "../../helpers/monitor-format.js";

interface InspectorHeaderProps {
  selectedRun: AdminRunDetail | null;
  selectedSummary: AdminRunSummary | null;
}

export function InspectorHeader({ selectedRun, selectedSummary }: InspectorHeaderProps) {
  return (
    <header className="border-b border-border px-6 py-5 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Inspector</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            {selectedRun?.run.threadTitle ?? "No run selected"}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            {selectedSummary
              ? `${selectedSummary.source} transport, ${selectedSummary.status} state, latest event ${selectedSummary.latestEventType ?? "pending"}.`
              : "Select a run to inspect the transcript, audit timeline, and context."}
          </p>
        </div>

        {selectedSummary ? (
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.16em]">
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-muted-foreground">
              {selectedSummary.source}
            </span>
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-muted-foreground">
              {selectedSummary.status}
            </span>
            <span className="rounded-full border border-border bg-card px-3 py-1.5 text-muted-foreground">
              {formatTime(selectedSummary.latestEventAt)}
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
