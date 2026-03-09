import { eq } from "drizzle-orm";
import { sessions, type SessionRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class SessionsDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: SessionRow): Promise<void> {
    await this.db.insert(sessions).values(values);
  }

  async findById(id: string): Promise<SessionRow | undefined> {
    return this.db.query.sessions.findFirst({
      where: eq(sessions.id, id),
    });
  }

  async updateById(id: string, patch: Partial<Pick<SessionRow, "updatedAt" | "lastThreadId">>): Promise<void> {
    await this.db.update(sessions).set(patch).where(eq(sessions.id, id));
  }
}
