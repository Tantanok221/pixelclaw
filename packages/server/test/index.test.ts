import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveDatabasePath } from "../src/index.js";

describe("resolveDatabasePath", () => {
  it("uses the Pixelclaw system directory by default", async () => {
    vi.spyOn(os, "homedir").mockReturnValue("/tmp/pixel-home");
    delete process.env.DATABASE_PATH;

    await expect(resolveDatabasePath()).resolves.toBe(
      path.join("/tmp/pixel-home", ".pixelclaw", "workspace", "system", "pixelclaw.sqlite"),
    );
  });

  it("prefers DATABASE_PATH when provided", async () => {
    process.env.DATABASE_PATH = "/tmp/custom.sqlite";

    await expect(resolveDatabasePath()).resolves.toBe("/tmp/custom.sqlite");

    delete process.env.DATABASE_PATH;
  });
});
