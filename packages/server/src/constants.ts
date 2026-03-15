export const SESSION_COOKIE = "pixelclaw_session";

export const COMPACTION_CONTEXT_LIMIT_TOKENS = 128_000;
export const COMPACTION_TRIGGER_PERCENT = 0.95;
export const COMPACTION_PRESERVE_LAST_TURNS = 6;
export const ESTIMATED_SYSTEM_PROMPT_TOKENS = 256;
export const ESTIMATED_MESSAGE_OVERHEAD_TOKENS = 12;

export const TELEGRAM_POLL_TIMEOUT_SECONDS = 30;
export const TELEGRAM_RETRY_DELAY_MS = 1000;
export const GITHUB_MONITOR_HEARTBEAT_MS = 15_000;
export const GITHUB_MONITOR_RETRY_DELAY_MS = 60_000;
export const TELEGRAM_STATUS_DELETE_DELAY_MS = 3000;
export const TELEGRAM_WHIMSICAL_HEADLINE_UPDATE_INTERVAL_MS = 5000;
export const TELEGRAM_PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

export const TELEGRAM_COMMANDS = {
  help: "/help",
  mode: "/mode",
  new: "/new",
  stop: "/stop",
} as const;

export const TELEGRAM_MESSAGES = {
  help: [
    "Available commands:",
    "/new - Start a new chat.",
    "/mode work - Use the work agent with tools.",
    "/mode chat - Use the chat voice agent.",
    "/stop - Stop the current activity.",
  ].join("\n"),
  invalidMode: "Usage: /mode chat|work",
  modeSetChat: 'Mode set to "chat".',
  modeSetWork: 'Mode set to "work".',
  startedNewChat: "Started a new chat.",
  stopping: "Stopping current activity.",
  nothingToStop: "Nothing is currently running.",
  streamingPlaceholder: "...",
  stoppedReply: "Stopped.",
  stoppedError: "Stopped by user.",
} as const;

export const TELEGRAM_WHIMSICAL_HEADLINES = [
  "Schlepping...",
  "Combobulating...",
  "Concocting...",
  "Spelunking...",
  "Whirring...",
  "Cogitating...",
  "Percolating...",
  "Simmering...",
  "Brewing...",
  "Musing...",
  "Tinkering...",
  "Wrangling...",
  "Skittering...",
  "Swashbuckling...",
  "Bubbling...",
  "Scintillating...",
  "Synthesizing...",
  "Sleuthing...",
  "Fossicking...",
  "Snazzifying...",
] as const;
