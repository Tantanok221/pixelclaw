import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSystemPrompt } from "../src/runtime.js";

const capturedAgentOptions: Array<Record<string, unknown>> = [];
const queuedAgentScenarios: Array<{
  events?: Array<Record<string, unknown>>;
  error?: Error;
}> = [];

const { MockAgent } = vi.hoisted(() => {
  class MockAgent {
    state = {
      messages: [],
      error: undefined,
    };

    private readonly events: Array<Record<string, unknown>>;
    private readonly error: Error | undefined;
    private subscriber: ((event: Record<string, unknown>) => void) | undefined;

    constructor(options: Record<string, unknown>) {
      capturedAgentOptions.push(options);
      const scenario = queuedAgentScenarios.shift() ?? {};
      this.events = scenario.events ?? [];
      this.error = scenario.error;
    }

    subscribe(callback: (event: Record<string, unknown>) => void) {
      this.subscriber = callback;
      return () => undefined;
    }

    abort() {}

    async continue() {
      for (const event of this.events) {
        this.subscriber?.(event);
      }

      if (this.error) {
        throw this.error;
      }
    }
  }

  return { MockAgent };
});

vi.mock("@mariozechner/pi-agent-core", () => ({
  Agent: MockAgent,
}));

afterEach(() => {
  capturedAgentOptions.splice(0);
  queuedAgentScenarios.splice(0);
  delete process.env.OPENROUTER_API_KEY;
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

  it("keeps the original streamed response when no paraphrase files exist", async () => {
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "pixelclaw-runtime-"));

    queuedAgentScenarios.push({
      events: [
        { type: "turn_start" },
        {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Plain answer" },
        },
        {
          type: "message_update",
          assistantMessageEvent: {
            type: "done",
            message: createAssistantMessage("Plain answer"),
          },
        },
      ],
    });

    const { runAgentThread } = await import("../src/runtime.js");
    const result = await runAgentThread({
      cwd: tempDir,
      messages: [{ role: "user", content: "Hi" }],
      onEvent: (event) => events.push(event),
    });

    expect(result.text).toBe("Plain answer");
    expect(capturedAgentOptions).toHaveLength(1);
    expect(events).toEqual([
      { type: "run.started" },
      { type: "run.state.changed", state: "planning" },
      { type: "run.state.changed", state: "finalizing" },
      { type: "message.delta", delta: "Plain answer" },
      { type: "message.completed", text: "Plain answer" },
    ]);
  });

  it("paraphrases the final response with workspace identity and souls instructions", async () => {
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pixelclaw-runtime-"));
    const nestedCwd = path.join(workspaceRoot, "apps", "chat");
    await mkdir(nestedCwd, { recursive: true });
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    await writeFile(path.join(workspaceRoot, "identity.md"), "Speak with crisp confidence.");
    await writeFile(path.join(workspaceRoot, "souls.md"), "Keep the tone warm and slightly playful.");

    queuedAgentScenarios.push(
      {
        events: [
          { type: "turn_start" },
          {
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "Base answer" },
          },
          {
            type: "message_update",
            assistantMessageEvent: {
              type: "done",
              message: createAssistantMessage("Base answer"),
            },
          },
        ],
      },
      {
        events: [
          { type: "turn_start" },
          {
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "Vibed answer" },
          },
          {
            type: "message_update",
            assistantMessageEvent: {
              type: "done",
              message: createAssistantMessage("Vibed answer"),
            },
          },
        ],
      },
    );

    const { runAgentThread } = await import("../src/runtime.js");
    const result = await runAgentThread({
      cwd: nestedCwd,
      messages: [{ role: "user", content: "Hi" }],
      onEvent: (event) => events.push(event),
    });

    expect(result.text).toBe("Vibed answer");
    expect(capturedAgentOptions).toHaveLength(2);

    const paraphraseOptions = capturedAgentOptions[1];
    const paraphraseState = paraphraseOptions.initialState as Record<string, unknown>;
    const paraphraseMessages = paraphraseState.messages as Array<Record<string, unknown>>;
    const paraphraseModel = paraphraseState.model as Record<string, unknown>;

    expect(paraphraseState.systemPrompt).toEqual(
      expect.stringContaining("Speak with crisp confidence."),
    );
    expect(paraphraseState.systemPrompt).toEqual(
      expect.stringContaining("Keep the tone warm and slightly playful."),
    );
    expect(paraphraseMessages).toEqual([
      expect.objectContaining({
        role: "user",
        content: expect.stringContaining("Base answer"),
      }),
    ]);
    expect(paraphraseModel).toMatchObject({
      provider: "openrouter",
      id: "x-ai/grok-4.1-fast",
      api: "openai-completions",
    });
    await expect(
      (paraphraseOptions.getApiKey as (() => Promise<string | undefined>))(),
    ).resolves.toBe("openrouter-test-key");
    expect(events).toEqual([
      { type: "run.started" },
      { type: "run.state.changed", state: "planning" },
      { type: "run.state.changed", state: "finalizing" },
      { type: "message.delta", delta: "Vibed answer" },
      { type: "message.completed", text: "Vibed answer" },
    ]);
  });

  it("uses the chat voice agent as the primary agent in chat mode", async () => {
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pixelclaw-runtime-"));
    process.env.OPENROUTER_API_KEY = "openrouter-test-key";
    await writeFile(path.join(workspaceRoot, "identity.md"), "Speak with crisp confidence.");
    await writeFile(path.join(workspaceRoot, "souls.md"), "Keep the tone warm and slightly playful.");

    queuedAgentScenarios.push({
      events: [
        { type: "turn_start" },
        {
          type: "message_update",
          assistantMessageEvent: { type: "text_delta", delta: "Chat mode answer" },
        },
        {
          type: "message_update",
          assistantMessageEvent: {
            type: "done",
            message: createAssistantMessage("Chat mode answer"),
          },
        },
      ],
    });

    const { runAgentThread } = await import("../src/runtime.js");
    const result = await runAgentThread({
      cwd: workspaceRoot,
      mode: "chat",
      messages: [{ role: "user", content: "Hi" }],
      onEvent: (event) => events.push(event),
    });

    expect(result.text).toBe("Chat mode answer");
    expect(capturedAgentOptions).toHaveLength(1);
    const [agentOptions] = capturedAgentOptions;
    const initialState = agentOptions.initialState as Record<string, unknown>;
    const model = initialState.model as Record<string, unknown>;

    expect(model).toMatchObject({
      provider: "openrouter",
      id: "x-ai/grok-4.1-fast",
      api: "openai-completions",
    });
    expect(initialState.tools).toEqual([]);
    expect(initialState.systemPrompt).toEqual(
      expect.stringContaining("Speak with crisp confidence."),
    );
    expect(initialState.systemPrompt).toEqual(
      expect.stringContaining("Keep the tone warm and slightly playful."),
    );
    expect(events).toEqual([
      { type: "run.started" },
      { type: "run.state.changed", state: "planning" },
      { type: "run.state.changed", state: "finalizing" },
      { type: "message.delta", delta: "Chat mode answer" },
      { type: "message.completed", text: "Chat mode answer" },
    ]);
  });

  it("falls back to the original response when the paraphrase pass fails", async () => {
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "pixelclaw-runtime-"));
    await writeFile(path.join(workspaceRoot, "identity.md"), "Sharp voice.");

    queuedAgentScenarios.push(
      {
        events: [
          { type: "turn_start" },
          {
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: "Raw answer" },
          },
          {
            type: "message_update",
            assistantMessageEvent: {
              type: "done",
              message: createAssistantMessage("Raw answer"),
            },
          },
        ],
      },
      {
        error: new Error("paraphrase failed"),
      },
    );

    const { runAgentThread } = await import("../src/runtime.js");
    const result = await runAgentThread({
      cwd: workspaceRoot,
      messages: [{ role: "user", content: "Hi" }],
      onEvent: (event) => events.push(event),
    });

    expect(result.text).toBe("Raw answer");
    expect(capturedAgentOptions).toHaveLength(2);
    expect(events).toEqual([
      { type: "run.started" },
      { type: "run.state.changed", state: "planning" },
      { type: "run.state.changed", state: "finalizing" },
      { type: "message.completed", text: "Raw answer" },
    ]);
  });
});

function createAssistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
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
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}
