import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { defaultModelProvider, type BaseModelProvider } from "./ModelProvider.js";
import { resolveAgentOutput } from "./runtime.js";

const COMPACTION_SYSTEM_PROMPT = [
  "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.",
  "Include:",
  "Current progress and key decisions made",
  "Important context, constraints, or user preferences",
  "What remains to be done (clear next steps)",
  "Any critical data, examples, or references needed to continue",
  "Be concise, structured, and focused on helping the next LLM seamlessly continue the work.",
].join("\n");

export interface CompactionSummaryMessage {
  role: "user" | "assistant";
  content: string;
}

export interface RunCompactionSummaryOptions {
  modelProvider?: BaseModelProvider;
}

export async function runCompactionSummary(
  messages: CompactionSummaryMessage[],
  options: RunCompactionSummaryOptions = {},
): Promise<string> {
  const modelProvider = options.modelProvider ?? defaultModelProvider;
  const agent = new Agent({
    initialState: {
      systemPrompt: COMPACTION_SYSTEM_PROMPT,
      model: modelProvider.getModel(),
      tools: [],
      messages: [buildCompactionPrompt(messages)],
    },
    getApiKey: async () => modelProvider.getApiKey(),
  });

  await agent.continue();
  const summary = resolveAgentOutput(agent.state.messages as AgentMessage[], "", agent.state.error);

  if (!summary) {
    throw new Error(agent.state.error ?? "Compaction summarizer returned no output");
  }

  return summary;
}

function buildCompactionPrompt(messages: CompactionSummaryMessage[]): AgentMessage {
  const transcript = messages
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join("\n\n");

  return {
    role: "user",
    content: transcript || "(no conversation content)",
    timestamp: Date.now(),
  };
}
