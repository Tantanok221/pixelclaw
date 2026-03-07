import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import { TodoStore } from "../todos/store.js";

const readTodoSchema = Type.Object({});

export function createReadTodoTool(store: TodoStore): AgentTool<typeof readTodoSchema> {
  return {
    name: "read_todo",
    label: "read_todo",
    description: "Read the full todo list for the current session.",
    parameters: readTodoSchema,
    execute: async () => {
      const document = await store.readTodo();
      return {
        content: [{ type: "text", text: JSON.stringify(document, null, 2) }],
        details: undefined,
      };
    },
  };
}
