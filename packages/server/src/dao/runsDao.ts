import { desc, eq } from "drizzle-orm";
import { runs, type RunRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class RunsDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: RunRow): Promise<void> {
    await this.db.insert(runs).values(values);
  }

  async findById(id: string): Promise<RunRow | undefined> {
    return this.db.query.runs.findFirst({
      where: eq(runs.id, id),
    });
  }

  async listAll(): Promise<RunRow[]> {
    return this.db.query.runs.findMany({
      orderBy: [desc(runs.startedAt), desc(runs.finishedAt)],
    });
  }

  async updateById(
    id: string,
    patch: Partial<Pick<RunRow, "status" | "error" | "startedAt" | "finishedAt">>,
  ): Promise<void> {
    await this.db.update(runs).set(patch).where(eq(runs.id, id));
  }
}
