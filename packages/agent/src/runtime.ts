import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultModelProvider,
  paraphraseModelProvider,
  type BaseModelProvider,
} from "./ModelProvider.js";
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
  modelProvider?: BaseModelProvider;
  mode?: "work" | "chat";
  onEvent?: (event: AgentRunEvent) => void;
  signal?: AbortSignal;
}

export function buildSystemPrompt(cwd: string): string {
  return [
    "You are Pixel, a chatty and helpful assistant.",
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
  const workModelProvider = options.modelProvider ?? defaultModelProvider;
  const mode = options.mode ?? "work";
  const voiceInstructions = await loadWorkspaceVoiceInstructions(cwd);
  const shouldParaphrase = mode === "work" && Boolean(voiceInstructions);
  const mainModelProvider = mode === "chat" ? paraphraseModelProvider : workModelProvider;
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
      systemPrompt:
        mode === "chat" ? buildChatModeSystemPrompt(cwd, voiceInstructions) : buildSystemPrompt(cwd),
      model: mainModelProvider.getModel(),
      tools:
        mode === "chat"
          ? []
          : createAgentTools(cwd, {
              sessionId: options.sessionId,
              onTodoUpdate: (todoDocument) => {
                options.onEvent?.({ type: "todo.updated", todoDocument });
              },
            }),
      messages: options.messages.map((message) => toAgentMessage(message, mainModelProvider)),
    },
    sessionId: options.sessionId,
    getApiKey: async () => mainModelProvider.getApiKey(cwd),
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
      if (!shouldParaphrase) {
        options.onEvent?.({ type: "message.delta", delta: streamEvent.delta });
      }
      return;
    }

    if (streamEvent.type === "done") {
      emitState("finalizing");
      const text = getAssistantText(streamEvent.message);
      if (!shouldParaphrase) {
        options.onEvent?.({ type: "message.completed", text });
      }
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

  if (!shouldParaphrase || !voiceInstructions || !text) {
    return { text };
  }

  const paraphrasedText = await runParaphrasePass({
    cwd,
    sessionId: options.sessionId,
    inputText: text,
    systemPrompt: buildParaphraseSystemPrompt(voiceInstructions),
    signal: options.signal,
  });

  if (!paraphrasedText) {
    options.onEvent?.({ type: "message.completed", text });
    return { text };
  }

  emitState("finalizing");
  options.onEvent?.({ type: "message.delta", delta: paraphrasedText });
  options.onEvent?.({ type: "message.completed", text: paraphrasedText });

  return { text: paraphrasedText };
}

async function runParaphrasePass(options: {
  cwd: string;
  sessionId?: string;
  inputText: string;
  systemPrompt: string;
  signal?: AbortSignal;
}): Promise<string> {
  const textChunks: string[] = [];
  const paraphraseAgent = new Agent({
    initialState: {
      systemPrompt: options.systemPrompt,
      model: paraphraseModelProvider.getModel(),
      tools: [],
      messages: [
        {
          role: "user",
          content: buildParaphraseRequest(options.inputText),
          timestamp: Date.now(),
        },
      ],
    },
    sessionId: options.sessionId ? `${options.sessionId}:paraphrase` : undefined,
    getApiKey: async () => paraphraseModelProvider.getApiKey(options.cwd),
  });

  const abortAgent = () => {
    paraphraseAgent.abort();
  };

  if (options.signal?.aborted) {
    abortAgent();
  }

  options.signal?.addEventListener("abort", abortAgent, { once: true });

  const unsubscribe = paraphraseAgent.subscribe((event) => {
    if (event.type !== "message_update") {
      return;
    }

    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type === "text_delta") {
      textChunks.push(streamEvent.delta);
    }
  });

  try {
    await paraphraseAgent.continue();
  } catch {
    return "";
  } finally {
    options.signal?.removeEventListener("abort", abortAgent);
    unsubscribe();
  }

  return resolveAgentOutput(paraphraseAgent.state.messages, textChunks.join(""), paraphraseAgent.state.error);
}

async function loadWorkspaceVoiceInstructions(
  cwd: string,
): Promise<{ identity: string; souls: string } | null> {
  const workspaceRoot = await resolveParaphraseWorkspaceRoot(cwd);
  const [identity, souls] = await Promise.all([
    readOptionalFile(path.join(workspaceRoot, "identity.md")),
    readOptionalFile(path.join(workspaceRoot, "souls.md")),
  ]);

  if (!identity && !souls) {
    return null;
  }

  return { identity, souls };
}

async function resolveParaphraseWorkspaceRoot(startDir: string): Promise<string> {
  let currentDir = path.resolve(startDir);

  while (true) {
    const [hasIdentity, hasSouls] = await Promise.all([
      pathExists(path.join(currentDir, "identity.md")),
      pathExists(path.join(currentDir, "souls.md")),
    ]);

    if (hasIdentity || hasSouls) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return path.resolve(startDir);
    }

    currentDir = parentDir;
  }
}

function buildParaphraseSystemPrompt(options: { identity: string; souls: string }) {
  return [
    "You are Pixel's paraphrase layer.",
    "Rewrite the final assistant reply using the voice and vibe defined below.",
    "Preserve the original meaning, facts, instructions, and safety constraints.",
    "Do not add new claims or omit important details.",
    "Keep markdown structure, code blocks, commands, file paths, URLs, and structured data intact unless a surrounding sentence can be safely reworded.",
    "Return only the rewritten assistant reply.",
    options.identity ? `Identity:\n${options.identity}` : "",
    options.souls ? `Souls:\n${options.souls}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildChatModeSystemPrompt(
  cwd: string,
  voiceInstructions: { identity: string; souls: string } | null,
) {
  return [
    "You are Pixel in chat mode.",
    "Reply directly to the user in a natural conversational style.",
    "No tools are available in this mode.",
    `Your current working directory is ${cwd}.`,
    voiceInstructions?.identity ? `Identity:\n${voiceInstructions.identity}` : "",
    voiceInstructions?.souls ? `Souls:\n${voiceInstructions.souls}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildParaphraseRequest(text: string) {
  return [
    "Rewrite the assistant reply below with the configured voice while keeping the exact intent and practical content.",
    "Assistant reply:",
    text,
  ].join("\n\n");
}

async function readOptionalFile(filePath: string): Promise<string> {
  try {
    return (await readFile(filePath, "utf-8")).trim();
  } catch {
    return "";
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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

function toAgentMessage(message: ThreadMessageInput, modelProvider: BaseModelProvider): AgentMessage {
  const timestamp = toTimestamp(message.createdAt);
  if (message.role === "user") {
    return {
      role: "user",
      content: message.content,
      timestamp,
    };
  }

  return modelProvider.createAssistantMessage(message.content, timestamp);
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
