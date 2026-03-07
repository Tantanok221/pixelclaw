import "dotenv/config";
import { Agent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { getConfiguredModel, getProviderApiKey } from "./ModelProvider.js";
import { createAgentTools } from "./tools/index.js";

const SYSTEM_PROMPT = [
  "You are Pixelbot, a concise and helpful assistant.",
  "At the start of each new session or task, call list_skill once before planning or using other tools.",
  "If a relevant skill appears, call load_skill for that skill and follow its instructions.",
].join(" ");

export async function runAgentPrompt(prompt: string): Promise<string> {
  const textChunks: string[] = [];
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: getConfiguredModel(),
      tools: createAgentTools(process.cwd()),
    },
    getApiKey: async () => getProviderApiKey(),
  });

  const unsubscribe = agent.subscribe((event) => {
    if (event.type === "message_update") {
      const streamEvent = event.assistantMessageEvent;
      switch (streamEvent.type) {
        case "start":
          console.log(`Starting with ${streamEvent.partial.model}`);
          break;
        case "text_start":
          console.log("\n[Text started]");
          break;
        case "text_delta":
          textChunks.push(streamEvent.delta);
          process.stdout.write(streamEvent.delta);
          break;
        case "text_end":
          console.log("\n[Text ended]");
          break;
        case "thinking_start":
          console.log("[Model is thinking...]");
          break;
        case "thinking_delta":
          process.stdout.write(streamEvent.delta);
          break;
        case "thinking_end":
          console.log("[Thinking complete]");
          break;
        case "toolcall_start":
          console.log(`\n[Tool call started: index ${streamEvent.contentIndex}]`);
          break;
        case "toolcall_delta": {
          const partialCall = streamEvent.partial.content[streamEvent.contentIndex];
          if (partialCall?.type === "toolCall") {
            console.log(`[Streaming args for ${partialCall.name}]`);
          }
          break;
        }
        case "toolcall_end":
          console.log(`\nTool called: ${streamEvent.toolCall.name}`);
          console.log(`Arguments: ${JSON.stringify(streamEvent.toolCall.arguments)}`);
          break;
        case "done":
          console.log(`\nFinished: ${streamEvent.reason}`);
          break;
        case "error":
          console.error(`Error: ${streamEvent.error.errorMessage ?? "Unknown error"}`);
          break;
      }
    }
    if (event.type === "tool_execution_start") {
      console.log(`\n[Executing tool: ${event.toolName}]`);
    }
    if (event.type === "tool_execution_end") {
      console.log(`[Tool completed: ${event.toolName}]`);
    }
  });

  try {
    await agent.prompt(prompt);
  } finally {
    unsubscribe();
  }

  const streamedText = textChunks.join("");
  const output = resolveAgentOutput(agent.state.messages, streamedText, agent.state.error);

  if (!streamedText && output) {
    if (agent.state.error) {
      console.error(output);
    } else {
      console.log(output);
    }
  }

  return output;
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
      return message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
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

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();

  if (!prompt) {
    console.log('Usage: npm run dev -- "your prompt here"');
    process.exitCode = 1;
    return;
  }
  await runAgentPrompt(prompt);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
