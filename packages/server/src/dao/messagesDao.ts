import { asc, eq } from "drizzle-orm";
import { messages, type MessageRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class MessagesDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: MessageRow): Promise<void> {
    await this.db.insert(messages).values(values);
  }

  async findById(id: string): Promise<MessageRow | undefined> {
    return this.db.query.messages.findFirst({
      where: eq(messages.id, id),
    });
  }

  async listByThread(threadId: string): Promise<MessageRow[]> {
    return this.db.query.messages.findMany({
      where: eq(messages.threadId, threadId),
      orderBy: asc(messages.createdAt),
    });
  }

  async updateById(id: string, patch: Partial<Pick<MessageRow, "content" | "status">>): Promise<void> {
    await this.db.update(messages).set(patch).where(eq(messages.id, id));
  }
}
