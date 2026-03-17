import { desc, eq } from "drizzle-orm";
import { monitors, type MonitorRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class MonitorsDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: MonitorRow): Promise<void> {
    await this.db.insert(monitors).values(values);
  }

  async findById(id: string): Promise<MonitorRow | undefined> {
    return this.db.query.monitors.findFirst({
      where: eq(monitors.id, id),
    });
  }

  async listAll(): Promise<MonitorRow[]> {
    return this.db.query.monitors.findMany({
      orderBy: [desc(monitors.updatedAt), desc(monitors.createdAt)],
    });
  }

  async updateById(id: string, patch: Partial<MonitorRow>): Promise<void> {
    await this.db.update(monitors).set(patch).where(eq(monitors.id, id));
  }
}
