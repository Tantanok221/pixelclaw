import "dotenv/config";
import type { AgentRunEvent } from "./runtime.js";
import { resolveAgentOutput, runAgentThread } from "./runtime.js";

export { resolveAgentOutput, runAgentThread } from "./runtime.js";

export async function runAgentPrompt(prompt: string): Promise<string> {
  const result = await runAgentThread({
    messages: [{ role: "user", content: prompt }],
    onEvent: (event) => {
      handleCliEvent(event);
    },
  });

  if (result.text) {
    process.stdout.write("\n");
  }

  return result.text;
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

function handleCliEvent(event: AgentRunEvent) {
  switch (event.type) {
    case "run.started":
      console.log("Starting with gpt-5.4");
      console.log("\n[Text started]");
      break;
    case "message.delta":
      process.stdout.write(event.delta);
      break;
    case "message.completed":
      console.log("\n[Text ended]");
      console.log("\nFinished: stop");
      break;
    case "run.failed":
      console.error(`Error: ${event.error}`);
      break;
    default:
      break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
