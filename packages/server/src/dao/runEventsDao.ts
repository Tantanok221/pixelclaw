import { asc, eq } from "drizzle-orm";
import { runEvents, type RunEventRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class RunEventsDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: RunEventRow): Promise<void> {
    await this.db.insert(runEvents).values(values);
  }

  async findById(id: string): Promise<RunEventRow | undefined> {
    return this.db.query.runEvents.findFirst({
      where: eq(runEvents.id, id),
    });
  }

  async listByRun(runId: string): Promise<RunEventRow[]> {
    return this.db.query.runEvents.findMany({
      where: eq(runEvents.runId, runId),
      orderBy: asc(runEvents.createdAt),
    });
  }
}
