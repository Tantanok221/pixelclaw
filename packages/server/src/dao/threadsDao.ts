import { and, desc, eq } from "drizzle-orm";
import { threads, type ThreadRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class ThreadsDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: ThreadRow): Promise<void> {
    await this.db.insert(threads).values(values);
  }

  async findById(id: string): Promise<ThreadRow | undefined> {
    return this.db.query.threads.findFirst({
      where: eq(threads.id, id),
    });
  }

  async findByIdForSession(threadId: string, sessionId: string): Promise<ThreadRow | undefined> {
    return this.db.query.threads.findFirst({
      where: and(eq(threads.id, threadId), eq(threads.sessionId, sessionId)),
    });
  }

  async listBySession(sessionId: string): Promise<ThreadRow[]> {
    return this.db.query.threads.findMany({
      where: eq(threads.sessionId, sessionId),
      orderBy: [desc(threads.updatedAt), desc(threads.createdAt)],
    });
  }

  async updateById(id: string, patch: Partial<Pick<ThreadRow, "updatedAt">>): Promise<void> {
    await this.db.update(threads).set(patch).where(eq(threads.id, id));
  }
}
