import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import path from "node:path";
import { getConfiguredModel, getProviderApiKey } from "./ModelProvider.js";
import type { TodoDocument } from "./todos/store.js";
import { createAgentTools } from "./tools/index.js";
import { ensureAgentWorkspaceRoot } from "./workspaceRoot.js";

export interface ThreadMessageInput {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}

export type AgentRunState = "planning" | "running_tool" | "waiting_for_model" | "finalizing";

export type AgentRunEvent =
  | { type: "run.started" }
  | { type: "run.state.changed"; state: AgentRunState }
  | { type: "tool.started"; toolName: string; args: unknown }
  | { type: "tool.completed"; toolName: string; args: unknown; isError: boolean }
  | { type: "todo.updated"; todoDocument: TodoDocument }
  | { type: "message.delta"; delta: string }
  | { type: "message.completed"; text: string }
  | { type: "run.failed"; error: string };

export interface RunThreadOptions {
  messages: ThreadMessageInput[];
  sessionId?: string;
  cwd?: string;
  onEvent?: (event: AgentRunEvent) => void;
  signal?: AbortSignal;
}

export function buildSystemPrompt(cwd: string): string {
  return [
    "You are Pixelbot, a concise and helpful assistant.",
    "At the start of each new session or task, call list_skill once before planning or using other tools.",
    "If a relevant skill appears, call load_skill for that skill and follow its instructions.",
    "Use read_todo, write_todo, and update_todo to persist the session todo list while working.",
    `Your current working directory is ${cwd}.`,
    "Treat this directory as the base for locating existing files and deciding where to create new files unless the user says otherwise.",
    "If you need to understand the workspace layout before editing, inspect this directory first and reason outward from there.",
  ].join(" ");
}

export async function runAgentThread(options: RunThreadOptions): Promise<{ text: string }> {
  const textChunks: string[] = [];
  const workspaceRoot = await ensureAgentWorkspaceRoot();
  const cwd = resolveAgentCwd(options.cwd, workspaceRoot);
  let currentState: AgentRunState | undefined;
  const toolArgsByCallId = new Map<string, unknown>();
  const emitState = (state: AgentRunState) => {
    if (currentState === state) {
      return;
    }

    currentState = state;
    options.onEvent?.({ type: "run.state.changed", state });
  };
  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(cwd),
      model: getConfiguredModel(),
      tools: createAgentTools(cwd, {
        sessionId: options.sessionId,
        onTodoUpdate: (todoDocument) => {
          options.onEvent?.({ type: "todo.updated", todoDocument });
        },
      }),
      messages: options.messages.map(toAgentMessage),
    },
    sessionId: options.sessionId,
    getApiKey: async () => getProviderApiKey(),
  });

  options.onEvent?.({ type: "run.started" });

  const abortAgent = () => {
    agent.abort();
  };

  if (options.signal?.aborted) {
    abortAgent();
  }

  options.signal?.addEventListener("abort", abortAgent, { once: true });

  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "turn_start") {
      emitState("planning");
      return;
    }

    if (event.type === "tool_execution_start") {
      toolArgsByCallId.set(event.toolCallId, event.args);
      emitState("running_tool");
      options.onEvent?.({
        type: "tool.started",
        toolName: event.toolName,
        args: event.args,
      });
      return;
    }

    if (event.type === "tool_execution_end") {
      const args = toolArgsByCallId.get(event.toolCallId);
      toolArgsByCallId.delete(event.toolCallId);
      options.onEvent?.({
        type: "tool.completed",
        toolName: event.toolName,
        args,
        isError: event.isError,
      });
      emitState("waiting_for_model");
      return;
    }

    if (event.type !== "message_update") {
      return;
    }

    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type === "text_delta") {
      emitState("finalizing");
      textChunks.push(streamEvent.delta);
      options.onEvent?.({ type: "message.delta", delta: streamEvent.delta });
      return;
    }

    if (streamEvent.type === "done") {
      emitState("finalizing");
      const text = getAssistantText(streamEvent.message);
      options.onEvent?.({ type: "message.completed", text });
      return;
    }

    if (streamEvent.type === "error") {
      options.onEvent?.({
        type: "run.failed",
        error: streamEvent.error.errorMessage ?? "Unknown agent error",
      });
    }
  });

  try {
    await agent.continue();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    options.onEvent?.({ type: "run.failed", error: message });
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abortAgent);
    unsubscribe();
  }

  const text = resolveAgentOutput(agent.state.messages, textChunks.join(""), agent.state.error);
  if (!text && agent.state.error) {
    options.onEvent?.({ type: "run.failed", error: agent.state.error });
  }

  return { text };
}

function resolveAgentCwd(cwd: string | undefined, workspaceRoot: string): string {
  return cwd ? path.resolve(cwd) : workspaceRoot;
}

export function resolveAgentOutput(
  messages: AgentMessage[],
  streamedText: string,
  errorText?: string,
): string {
  if (streamedText) {
    return streamedText;
  }

  const latestAssistantText = getLatestAssistantText(messages);
  if (latestAssistantText) {
    return latestAssistantText;
  }

  return errorText ?? getLatestAssistantError(messages);
}

function toAgentMessage(message: ThreadMessageInput): AgentMessage {
  const timestamp = toTimestamp(message.createdAt);
  if (message.role === "user") {
    return {
      role: "user",
      content: message.content,
      timestamp,
    };
  }

  return {
    role: "assistant",
    content: [{ type: "text", text: message.content }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.4",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "stop",
    timestamp,
  };
}

function getLatestAssistantText(messages: AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (
      typeof message === "object" &&
      message &&
      "role" in message &&
      message.role === "assistant" &&
      "content" in message &&
      Array.isArray(message.content)
    ) {
      return getAssistantText(message as AssistantMessage);
    }
  }
  return "";
}

function getLatestAssistantError(messages: AgentMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (
      typeof message === "object" &&
      message &&
      "role" in message &&
      message.role === "assistant" &&
      "errorMessage" in message &&
      typeof message.errorMessage === "string"
    ) {
      return message.errorMessage;
    }
  }

  return "";
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function toTimestamp(createdAt?: string) {
  const timestamp = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}
