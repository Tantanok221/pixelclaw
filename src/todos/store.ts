import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type TodoStatus = "pending" | "in_progress" | "done" | "blocked";

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  note: string;
}

export interface TodoDocument {
  sessionId: string;
  updatedAt: string;
  todos: TodoItem[];
}

export interface TodoStoreOptions {
  rootDir?: string;
  sessionId?: string;
}

export interface WriteTodoInput {
  id?: string;
  text: string;
  status: TodoStatus;
  note: string;
}

export interface UpdateTodoInput {
  id: string;
  text?: string;
  status?: TodoStatus;
  note?: string;
}

const DEFAULT_ROOT_DIR = path.join(os.tmpdir(), "pixelbot", "todos");

export class TodoStore {
  readonly sessionId: string;
  private readonly rootDir: string;
  private readonly statePath: string;

  constructor(options: TodoStoreOptions = {}) {
    this.sessionId = options.sessionId ?? randomUUID();
    this.rootDir = options.rootDir ?? DEFAULT_ROOT_DIR;
    this.statePath = path.join(this.rootDir, `${this.sessionId}.json`);
  }

  async readTodo(): Promise<TodoDocument> {
    try {
      const rawState = await fs.readFile(this.statePath, "utf-8");
      return normalizeDocument(JSON.parse(rawState) as Partial<TodoDocument>, this.sessionId);
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return createDefaultDocument(this.sessionId);
      }
      throw error;
    }
  }

  async writeTodo(todos: WriteTodoInput[]): Promise<TodoDocument> {
    const document: TodoDocument = {
      sessionId: this.sessionId,
      updatedAt: nowIso(),
      todos: todos.map((todo) => ({
        id: todo.id ?? randomUUID(),
        text: todo.text,
        status: todo.status,
        note: todo.note,
      })),
    };

    await this.writeDocument(document);
    return document;
  }

  async updateTodo(input: UpdateTodoInput): Promise<TodoItem> {
    const document = await this.readTodo();
    const index = document.todos.findIndex((todo) => todo.id === input.id);

    if (index === -1) {
      throw new Error(`Todo not found: ${input.id}`);
    }

    const current = document.todos[index]!;
    const next: TodoItem = {
      id: current.id,
      text: input.text ?? current.text,
      status: input.status ?? current.status,
      note: input.note ?? current.note,
    };

    const nextDocument: TodoDocument = {
      sessionId: document.sessionId,
      updatedAt: nowIso(),
      todos: document.todos.map((todo, todoIndex) => (todoIndex === index ? next : todo)),
    };

    await this.writeDocument(nextDocument);
    return next;
  }

  private async writeDocument(document: TodoDocument): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
    await fs.writeFile(this.statePath, `${JSON.stringify(document, null, 2)}\n`, "utf-8");
  }
}

function createDefaultDocument(sessionId: string): TodoDocument {
  return {
    sessionId,
    updatedAt: nowIso(),
    todos: [],
  };
}

function normalizeDocument(state: Partial<TodoDocument>, sessionId: string): TodoDocument {
  return {
    sessionId: typeof state.sessionId === "string" && state.sessionId ? state.sessionId : sessionId,
    updatedAt: typeof state.updatedAt === "string" && state.updatedAt ? state.updatedAt : nowIso(),
    todos: Array.isArray(state.todos)
      ? (state.todos.map(normalizeTodo).filter((todo): todo is TodoItem => todo !== null) as TodoItem[])
      : [],
  };
}

function normalizeTodo(todo: unknown): TodoItem | null {
  if (!todo || typeof todo !== "object") {
    return null;
  }

  const candidate = todo as Partial<TodoItem>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.text !== "string" ||
    !isTodoStatus(candidate.status) ||
    typeof candidate.note !== "string"
  ) {
    return null;
  }

  return {
    id: candidate.id,
    text: candidate.text,
    status: candidate.status,
    note: candidate.note,
  };
}

export function isTodoStatus(status: unknown): status is TodoStatus {
  return status === "pending" || status === "in_progress" || status === "done" || status === "blocked";
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function nowIso() {
  return new Date().toISOString();
}
