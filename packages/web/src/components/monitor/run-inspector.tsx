import { Card } from "../ui/card.js";
import { ScrollArea } from "../ui/scroll-area.js";
import type { AdminRunDetail, AdminRunEvent, AdminRunSummary } from "../../lib/monitor-client.js";
import { cn } from "../../lib/utils.js";
import type { InspectorTab } from "./types.js";
import { eventDotClassName } from "../../helpers/monitor-style.js";
import { formatDateTime, formatEventPayload, formatTime } from "../../helpers/monitor-format.js";

interface RunInspectorProps {
  onTabChange: (tab: InspectorTab) => void;
  selectedEvents: AdminRunEvent[];
  selectedRun: AdminRunDetail;
  selectedSummary: AdminRunSummary | null;
  selectedTab: InspectorTab;
}

export function RunInspector({
  onTabChange,
  selectedEvents,
  selectedRun,
  selectedSummary,
  selectedTab,
}: RunInspectorProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.95fr)]">
      <Card className="rounded-3xl border border-border bg-card shadow-none">
        <div className="border-b border-border px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {(["timeline", "transcript", "context"] as InspectorTab[]).map((tab) => (
              <ButtonLikeTab
                key={tab}
                isSelected={selectedTab === tab}
                onClick={() => {
                  onTabChange(tab);
                }}
              >
                {tab}
              </ButtonLikeTab>
            ))}
          </div>
        </div>

        <ScrollArea className="max-h-[72vh] px-5 py-5">
          {selectedTab === "timeline" ? <TimelinePanel selectedEvents={selectedEvents} /> : null}
          {selectedTab === "transcript" ? <TranscriptPanel selectedRun={selectedRun} /> : null}
          {selectedTab === "context" ? <ContextPanel selectedRun={selectedRun} /> : null}
        </ScrollArea>
      </Card>

      <div className="space-y-6">
        <Card className="rounded-3xl border border-border bg-card shadow-none">
          <div className="border-b border-border px-5 py-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current focus</p>
            <h3 className="mt-2 text-lg font-semibold tracking-tight">{selectedRun.run.threadTitle}</h3>
          </div>
          <div className="space-y-4 px-5 py-5">
            <div className="rounded-2xl border border-border bg-background px-4 py-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">What it is doing</p>
              <p className="mt-3 text-sm leading-6">
                {selectedSummary?.latestEventType
                  ? `${selectedSummary.latestEventType} · ${selectedSummary.preview || "Waiting for output"}`
                  : "Waiting for runtime events."}
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-background px-4 py-4">
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Failure signal</p>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {selectedRun.run.error ?? "No error recorded for this run."}
              </p>
            </div>
          </div>
        </Card>

        <Card className="rounded-3xl border border-border bg-card shadow-none">
          <div className="border-b border-border px-5 py-4">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Activity summary</p>
          </div>
          <div className="space-y-4 px-5 py-5 text-sm text-muted-foreground">
            <div className="flex items-center justify-between gap-4">
              <span>Timeline events</span>
              <span className="text-foreground">{selectedEvents.length}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Transcript messages</span>
              <span className="text-foreground">{selectedRun.messages.length}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Inspector state</span>
              <span className="text-foreground">{selectedTab}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function TimelinePanel({ selectedEvents }: Pick<RunInspectorProps, "selectedEvents">) {
  return (
    <div className="space-y-3">
      {selectedEvents.map((event) => (
        <div key={event.id} className="rounded-2xl border border-border bg-background px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className={cn("size-2 rounded-full", eventDotClassName(event.type))} />
              <p className="text-sm font-medium">{event.type}</p>
            </div>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {formatTime(event.createdAt)}
            </p>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {formatEventPayload(event.payload)}
          </p>
        </div>
      ))}
    </div>
  );
}

function TranscriptPanel({ selectedRun }: Pick<RunInspectorProps, "selectedRun">) {
  return (
    <div className="space-y-3">
      {selectedRun.messages.map((message) => (
        <div
          key={message.id}
          className={cn(
            "rounded-2xl border px-4 py-4",
            message.role === "user" ? "border-border bg-muted/40" : "border-border bg-background",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium capitalize">{message.role}</p>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{message.status}</p>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
            {message.content || "No final content."}
          </p>
        </div>
      ))}
    </div>
  );
}

function ContextPanel({ selectedRun }: Pick<RunInspectorProps, "selectedRun">) {
  const items = [
    ["Run ID", selectedRun.run.id],
    ["Session ID", selectedRun.run.sessionId],
    ["Thread ID", selectedRun.run.threadId],
    ["Source", selectedRun.run.source],
    ["Status", selectedRun.run.status],
    ["Started", selectedRun.run.startedAt ? formatDateTime(selectedRun.run.startedAt) : "Not started"],
    ["Finished", selectedRun.run.finishedAt ? formatDateTime(selectedRun.run.finishedAt) : "Still running"],
    ["Latest event", selectedRun.run.latestEventType ?? "Pending"],
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-2xl border border-border bg-background px-4 py-4">
          <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
          <p className="mt-3 break-all text-sm leading-6">{value}</p>
        </div>
      ))}
    </div>
  );
}

function ButtonLikeTab({
  children,
  isSelected,
  onClick,
}: {
  children: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.16em] transition-colors",
        isSelected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
