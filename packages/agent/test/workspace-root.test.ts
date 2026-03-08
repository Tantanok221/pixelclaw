import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveAgentWorkspaceRoot } from "../src/workspaceRoot.js";

describe("resolveAgentWorkspaceRoot", () => {
  it("uses the Pixelclaw home directory under the user's home", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/tmp/pixel-home");

    expect(resolveAgentWorkspaceRoot()).toBe(path.join("/tmp/pixel-home", ".pixelclaw"));
  });
});
