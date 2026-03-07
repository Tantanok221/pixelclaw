import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type, type Static } from "@mariozechner/pi-ai";
import { TodoStore, isTodoStatus } from "../todos/store.js";

const updateTodoSchema = Type.Object({
  id: Type.String({ description: "Todo id to update" }),
  text: Type.Optional(Type.String({ description: "Updated todo text" })),
  status: Type.Optional(
    Type.String({ description: "Updated todo status: pending, in_progress, done, blocked" }),
  ),
  note: Type.Optional(Type.String({ description: "Updated todo note" })),
});

type UpdateTodoInput = Static<typeof updateTodoSchema>;

export function createUpdateTodoTool(store: TodoStore): AgentTool<typeof updateTodoSchema> {
  return {
    name: "update_todo",
    label: "update_todo",
    description: "Update a single todo within the current session's list.",
    parameters: updateTodoSchema,
    execute: async (_toolCallId, input: UpdateTodoInput) => {
      const todo = await store.updateTodo({
        id: input.id,
        text: input.text,
        status: input.status ? requireTodoStatus(input.status) : undefined,
        note: input.note,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(todo, null, 2) }],
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
