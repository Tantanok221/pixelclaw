import type { AgentRunState } from "../../../agent/src/runtime.js";
import type { TodoStatus } from "../../../agent/src/todos/store.js";
import {
  TELEGRAM_MESSAGES,
  TELEGRAM_WHIMSICAL_HEADLINE_UPDATE_INTERVAL_MS,
  TELEGRAM_WHIMSICAL_HEADLINES,
} from "../constants.js";
import type { TelegramDisplayState, TelegramStatusSnapshot } from "./types.js";

export function renderTelegramStatus(snapshot: TelegramStatusSnapshot) {
  const lines = [snapshot.headline, `State: ${snapshot.state}`];
  const toolName =
    snapshot.toolName ?? (isRetainedState(snapshot.state) ? snapshot.lastToolName : undefined);
  const target =
    snapshot.target ?? (isRetainedState(snapshot.state) ? snapshot.lastTarget : undefined);

  if (toolName) {
    lines.push(`Tool: ${toolName}`);
  }

  if (target) {
    lines.push(`Target: ${target}`);
  }

  if (snapshot.todos.length > 0) {
    lines.push("Todos:");
    for (const todo of snapshot.todos) {
      lines.push(`${todoStatusEmoji(todo.status)} ${todo.text}`);
    }
  }

  if (snapshot.error) {
    lines.push(`Error: ${snapshot.error}`);
  }

  lines.push(`Elapsed: ${formatElapsed(Date.now() - snapshot.startedAtMs)}`);
  return lines.join("\n");
}

export function mapRunState(state: AgentRunState): TelegramDisplayState {
  switch (state) {
    case "planning":
      return "planning";
    case "running_tool":
      return "running tool";
    case "waiting_for_model":
      return "waiting for model";
    case "finalizing":
      return "finalizing";
  }
}

export function extractTelegramTarget(args: unknown) {
  if (!args || typeof args !== "object") {
    return undefined;
  }

  const candidate = args as Record<string, unknown>;
  for (const key of ["path", "command", "name", "pattern", "query", "glob"]) {
    if (typeof candidate[key] === "string" && candidate[key]) {
      return candidate[key] as string;
    }
  }

  return undefined;
}

export function nextWhimsicalHeadline() {
  return TELEGRAM_WHIMSICAL_HEADLINES[
    Math.floor(Math.random() * TELEGRAM_WHIMSICAL_HEADLINES.length)
  ]!;
}

function shouldRefreshWhimsicalHeadline(lastHeadlineUpdatedAtMs: number, now = Date.now()) {
  return now - lastHeadlineUpdatedAtMs >= TELEGRAM_WHIMSICAL_HEADLINE_UPDATE_INTERVAL_MS;
}

export function resolveReplyPlaceholderText(placeholderText?: string) {
  const trimmed = placeholderText?.trim();
  return trimmed ? trimmed : TELEGRAM_MESSAGES.streamingPlaceholder;
}

export function clampTelegramReplyText(text: string, maxMessageLength: number) {
  const resolvedLimit = Number.isFinite(maxMessageLength)
    ? Math.max(1, Math.floor(maxMessageLength))
    : 4000;
  if (text.length <= resolvedLimit) {
    return text;
  }

  const suffix = "\n\n[truncated]";
  if (resolvedLimit <= suffix.length) {
    return text.slice(0, resolvedLimit);
  }

  return `${text.slice(0, resolvedLimit - suffix.length)}${suffix}`;
}

export function todoStatusEmoji(status: TodoStatus) {
  switch (status) {
    case "pending":
      return "⏳";
    case "in_progress":
      return "🔧";
    case "done":
      return "✅";
    case "blocked":
      return "🚫";
  }
}

export function isRetainedState(state: TelegramDisplayState) {
  return state === "failed" || state === "stopped";
}

export function formatElapsed(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}
