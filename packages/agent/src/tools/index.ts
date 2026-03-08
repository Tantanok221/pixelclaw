import type { AgentTool } from "@mariozechner/pi-agent-core";
import { randomUUID } from "node:crypto";
import { TodoStore, type TodoDocument } from "../todos/store.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createFindTool } from "./find.js";
import { createGrepTool } from "./grep.js";
import { createListSkillTool } from "./listSkill.js";
import { createLsTool } from "./ls.js";
import { createLoadSkillTool } from "./loadSkill.js";
import { createReadTool } from "./read.js";
import { createReadTodoTool } from "./readTodo.js";
import { createUpdateTodoTool } from "./updateTodo.js";
import { createWriteTool } from "./write.js";
import { createWriteTodoTool } from "./writeTodo.js";

export interface CreateAgentToolsOptions {
  sessionId?: string;
  onTodoUpdate?: (document: TodoDocument) => void | Promise<void>;
}

export function createAgentTools(cwd: string, options: CreateAgentToolsOptions = {}): AgentTool<any>[] {
  const todoStore = new TodoStore({ sessionId: options.sessionId ?? randomUUID() });

  return [
    createListSkillTool(cwd),
    createLoadSkillTool(cwd),
    createReadTodoTool(todoStore),
    createWriteTodoTool(todoStore, { onUpdated: options.onTodoUpdate }),
    createUpdateTodoTool(todoStore, { onUpdated: options.onTodoUpdate }),
    createReadTool(cwd),
    createBashTool(cwd),
    createEditTool(cwd),
    createWriteTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
  ];
}
