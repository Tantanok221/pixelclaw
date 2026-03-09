import { asc, eq } from "drizzle-orm";
import { sessionHandoffs, type SessionHandoffRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class SessionHandoffsDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: SessionHandoffRow): Promise<void> {
    await this.db.insert(sessionHandoffs).values(values);
  }

  async findById(id: string): Promise<SessionHandoffRow | undefined> {
    return this.db.query.sessionHandoffs.findFirst({
      where: eq(sessionHandoffs.id, id),
    });
  }

  async listByFromSession(sessionId: string): Promise<SessionHandoffRow[]> {
    return this.db.query.sessionHandoffs.findMany({
      where: eq(sessionHandoffs.fromSessionId, sessionId),
      orderBy: asc(sessionHandoffs.createdAt),
    });
  }
}
