import { runAgentThread, type AgentRunEvent } from "../../agent/src/runtime.js";

export interface ServerAgentMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface RunAgentOptions {
  sessionId: string;
  threadId: string;
  paraphraseEnabled?: boolean;
  messages: ServerAgentMessage[];
  onEvent: (event: AgentRunEvent) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function runDefaultAgentTurn(options: RunAgentOptions) {
  return runAgentThread({
    sessionId: options.sessionId,
    paraphraseEnabled: options.paraphraseEnabled,
    messages: options.messages,
    onEvent: options.onEvent,
    signal: options.signal,
  });
}
