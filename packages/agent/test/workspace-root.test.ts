import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAgentSystemRoot, resolveAgentWorkspaceRoot } from "../src/workspaceRoot.js";

describe("resolveAgentWorkspaceRoot", () => {
  afterEach(() => {
    delete process.env.PIXELCLAW_HOME;
    vi.restoreAllMocks();
  });

  it("uses the Pixelclaw workspace directory under the user's home", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/tmp/pixel-home");

    expect(resolveAgentWorkspaceRoot()).toBe(
      path.join("/tmp/pixel-home", ".pixelclaw", "workspace"),
    );
  });

  it("uses the Pixelclaw system directory under the user's home", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/tmp/pixel-home");

    expect(resolveAgentSystemRoot()).toBe(path.join("/tmp/pixel-home", ".pixelclaw", "system"));
  });

  it("treats PIXELCLAW_HOME as the Pixelclaw home directory", () => {
    process.env.PIXELCLAW_HOME = "/tmp/custom-home";

    expect(resolveAgentWorkspaceRoot()).toBe(path.join("/tmp/custom-home", "workspace"));
    expect(resolveAgentSystemRoot()).toBe(path.join("/tmp/custom-home", "system"));
  });
});
