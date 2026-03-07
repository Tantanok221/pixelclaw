import { describe, expect, it } from "vitest";
import { resolveAgentOutput } from "../src/index.js";

describe("resolveAgentOutput", () => {
  it("returns assistant error text when no assistant text was streamed", () => {
    const result = resolveAgentOutput(
      [
        {
          role: "assistant",
          content: [],
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "gpt-5.4",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "error",
          timestamp: Date.now(),
          errorMessage: '{"detail":{"code":"deactivated_workspace"}}',
        },
      ],
      "",
      '{"detail":{"code":"deactivated_workspace"}}',
    );

    expect(result).toContain("deactivated_workspace");
  });

  it("prefers streamed assistant text when available", () => {
    const result = resolveAgentOutput([], "hello", "ignored");

    expect(result).toBe("hello");
  });
});
