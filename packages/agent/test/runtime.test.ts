import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../src/runtime.js";

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
