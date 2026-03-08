import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { TodoStore, type TodoDocument, isTodoStatus } from "../todos/store.js";

const writeTodoSchema = Type.Object({
  todos: Type.Array(
    Type.Object({
      id: Type.Optional(Type.String({ description: "Optional todo id" })),
      text: Type.String({ description: "Todo text" }),
      status: Type.String({ description: "Todo status: pending, in_progress, done, blocked" }),
      note: Type.String({ description: "Short note for the todo" }),
    }),
  ),
});

type WriteTodoInput = Static<typeof writeTodoSchema>;

export interface WriteTodoToolOptions {
  onUpdated?: (document: TodoDocument) => void | Promise<void>;
}

export function createWriteTodoTool(
  store: TodoStore,
  options: WriteTodoToolOptions = {},
): AgentTool<typeof writeTodoSchema> {
  return {
    name: "write_todo",
    label: "write_todo",
    description: "Replace the full todo list for the current session.",
    parameters: writeTodoSchema,
    execute: async (_toolCallId, { todos }: WriteTodoInput) => {
      const normalizedTodos = todos.map((todo) => ({
        id: todo.id,
        text: todo.text,
        status: requireTodoStatus(todo.status),
        note: todo.note,
      }));
      const document = await store.writeTodo(normalizedTodos);
      await options.onUpdated?.(document);
      return {
        content: [{ type: "text", text: JSON.stringify(document, null, 2) }],
        details: undefined,
      };
    },
  };
}

function requireTodoStatus(status: string) {
  if (!isTodoStatus(status)) {
    throw new Error(`Invalid todo status: ${status}`);
  }

  return status;
}
