import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentTools } from "../src/tools/index.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createAgentTools", () => {
  it("binds todo tools to the provided session id", async () => {
    const cwd = await createTempDir("pixelclaw-agent-tools-");
    const sessionId = "session-under-test";
    const tools = createAgentTools(cwd, { sessionId });
    const writeTodo = tools.find((tool) => tool.name === "write_todo");
    const readTodo = tools.find((tool) => tool.name === "read_todo");

    expect(writeTodo).toBeTruthy();
    expect(readTodo).toBeTruthy();

    await writeTodo!.execute("call-1", {
      todos: [
        {
          text: "inspect telegram flow",
          status: "in_progress",
          note: "working",
        },
      ],
    });

    const result = await readTodo!.execute("call-2", {});
    const document = JSON.parse(result.content[0]!.text);

    expect(document.sessionId).toBe(sessionId);
    expect(document.todos).toMatchObject([
      {
        text: "inspect telegram flow",
        status: "in_progress",
        note: "working",
      },
    ]);
  });
});
