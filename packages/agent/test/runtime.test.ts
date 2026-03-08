import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../src/runtime.js";

const capturedAgentOptions: Array<Record<string, unknown>> = [];

const { MockAgent } = vi.hoisted(() => {
  class MockAgent {
    state = {
      messages: [],
      error: undefined,
    };

    constructor(options: Record<string, unknown>) {
      capturedAgentOptions.push(options);
    }

    subscribe() {
      return () => undefined;
    }

    abort() {}

    async continue() {}
  }

  return { MockAgent };
});

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: MockAgent,
}));

afterEach(() => {
  capturedAgentOptions.splice(0);
  vi.restoreAllMocks();
});

describe("buildSystemPrompt", () => {
  it("includes the effective working directory and file placement guidance", () => {
    const cwd = "/tmp/pixelclaw/workspace/project-a";

    const prompt = buildSystemPrompt(cwd);

    expect(prompt).toContain(`Your current working directory is ${cwd}.`);
    expect(prompt).toContain(
      "Treat this directory as the base for locating existing files and deciding where to create new files unless the user says otherwise.",
    );
  });
});

describe("runAgentThread", () => {
  it("uses the injected model provider for model config, API key lookup, and assistant message metadata", async () => {
    const [{ runAgentThread }, { BaseModelProvider }] = await Promise.all([
      import("../src/runtime.js"),
      import("../src/ModelProvider.js"),
    ]);

    class FakeModelProvider extends BaseModelProvider {
      readonly providerName = "fake-provider";
      readonly modelName = "fake-model";
      readonly apiName = "fake-api";

      getModel() {
        return { provider: this.providerName, model: this.modelName } as never;
      }

      async getApiKey() {
        return "fake-api-key";
      }

      createAssistantMessage(content: string, timestamp: number) {
        return {
          role: "assistant" as const,
          content: [{ type: "text" as const, text: `wrapped:${content}` }],
          api: this.apiName,
          provider: this.providerName,
          model: this.modelName,
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
          stopReason: "stop" as const,
          timestamp,
        };
      }
    }

    const provider = new FakeModelProvider();

    await runAgentThread({
      messages: [
        {
          role: "assistant",
          content: "Earlier reply",
          createdAt: "2024-01-02T03:04:05.000Z",
        },
      ],
      modelProvider: provider,
    });

    expect(capturedAgentOptions).toHaveLength(1);
    const [agentOptions] = capturedAgentOptions;
    const initialState = agentOptions.initialState as Record<string, unknown>;
    const messages = initialState.messages as Array<Record<string, unknown>>;

    expect(initialState.model).toEqual({
      provider: "fake-provider",
      model: "fake-model",
    });
    await expect(
      (agentOptions.getApiKey as ((provider: string) => Promise<string>))("unused-provider"),
    ).resolves.toBe("fake-api-key");
    expect(messages[0]).toMatchObject({
      role: "assistant",
      api: "fake-api",
      provider: "fake-provider",
      model: "fake-model",
      content: [{ type: "text", text: "wrapped:Earlier reply" }],
      timestamp: Date.parse("2024-01-02T03:04:05.000Z"),
    });
  });
});
