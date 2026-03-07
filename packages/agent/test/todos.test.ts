import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentTools } from "../src/tools/index.js";
import { TodoStore } from "../src/todos/store.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("TodoStore", () => {
  it("returns an empty default todo document for a session", async () => {
    const tempDir = await createTempDir("pixelbot-todos-");
    const store = new TodoStore({ rootDir: tempDir, sessionId: "session-a" });

    await expect(store.readTodo()).resolves.toMatchObject({
      sessionId: "session-a",
      todos: [],
    });
  });

  it("replaces the entire todo list for a session", async () => {
    const tempDir = await createTempDir("pixelbot-todos-");
    const store = new TodoStore({ rootDir: tempDir, sessionId: "session-a" });

    const firstWrite = await store.writeTodo([
      { text: "Add test", status: "pending", note: "start here" },
    ]);

    const secondWrite = await store.writeTodo([
      { id: firstWrite.todos[0]?.id, text: "Refactor loader", status: "in_progress", note: "" },
    ]);

    expect(secondWrite.todos).toEqual([
      {
        id: firstWrite.todos[0]?.id,
        text: "Refactor loader",
        status: "in_progress",
        note: "",
      },
    ]);
  });

  it("updates one todo without replacing the others", async () => {
    const tempDir = await createTempDir("pixelbot-todos-");
    const store = new TodoStore({ rootDir: tempDir, sessionId: "session-a" });

    const written = await store.writeTodo([
      { text: "Add test", status: "pending", note: "" },
      { text: "Update callers", status: "pending", note: "" },
    ]);

    const updated = await store.updateTodo({
      id: written.todos[0]!.id,
      status: "done",
      note: "verified",
    });

    expect(updated).toMatchObject({
      id: written.todos[0]!.id,
      text: "Add test",
      status: "done",
      note: "verified",
    });

    await expect(store.readTodo()).resolves.toMatchObject({
      todos: [
        {
          id: written.todos[0]!.id,
          text: "Add test",
          status: "done",
          note: "verified",
        },
        {
          id: written.todos[1]!.id,
          text: "Update callers",
          status: "pending",
          note: "",
        },
      ],
    });
  });

  it("isolates todos by session id", async () => {
    const tempDir = await createTempDir("pixelbot-todos-");
    const firstStore = new TodoStore({ rootDir: tempDir, sessionId: "session-a" });
    const secondStore = new TodoStore({ rootDir: tempDir, sessionId: "session-b" });

    await firstStore.writeTodo([{ text: "Task A", status: "pending", note: "" }]);
    await secondStore.writeTodo([{ text: "Task B", status: "done", note: "done" }]);

    await expect(firstStore.readTodo()).resolves.toMatchObject({
      sessionId: "session-a",
      todos: [{ text: "Task A", status: "pending", note: "" }],
    });

    await expect(secondStore.readTodo()).resolves.toMatchObject({
      sessionId: "session-b",
      todos: [{ text: "Task B", status: "done", note: "done" }],
    });
  });
});

describe("todo tools", () => {
  it("registers only the simplified todo tools", () => {
    const tools = createAgentTools("/tmp/project");

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["read_todo", "write_todo", "update_todo"]),
    );
    expect(tools.map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining([
        "get_active_task",
        "set_active_task",
        "clear_active_task",
        "list_todos",
        "upsert_todo",
        "set_resume_note",
      ]),
    );
  });
});
