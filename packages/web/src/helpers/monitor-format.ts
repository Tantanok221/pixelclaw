export function formatEventPayload(payload: Record<string, unknown>) {
  const entries = Object.entries(payload ?? {});
  if (entries.length === 0) {
    return "No payload metadata.";
  }

  return entries
    .map(([key, value]) => {
      if (typeof value === "string") {
        return `${key}: ${value}`;
      }

      return `${key}: ${JSON.stringify(value)}`;
    })
    .join(" • ");
}

export function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
