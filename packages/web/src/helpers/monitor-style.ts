import { cn } from "../lib/utils.js";

export function runBadgeClassName(isInverted: boolean) {
  return cn(
    "rounded-full border px-2.5 py-1",
    isInverted
      ? "border-background/30 bg-background/10 text-background/80"
      : "border-border bg-muted text-muted-foreground",
  );
}

export function runMetaClassName(isInverted: boolean) {
  return isInverted ? "text-background/70" : "text-muted-foreground";
}

export function statusDotClassName(status: string) {
  switch (status) {
    case "streaming":
    case "pending":
      return "bg-emerald-400";
    case "failed":
      return "bg-amber-300";
    default:
      return "bg-foreground/50";
  }
}

export function eventDotClassName(type: string) {
  if (type === "run.failed") {
    return "bg-amber-300";
  }

  if (type.startsWith("tool.")) {
    return "bg-sky-300";
  }

  if (type.startsWith("message.")) {
    return "bg-emerald-400";
  }

  return "bg-foreground/60";
}
