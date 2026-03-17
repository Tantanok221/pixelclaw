import { eq } from "drizzle-orm";
import { monitorEvents, type MonitorEventRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class MonitorEventsDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: MonitorEventRow): Promise<void> {
    await this.db.insert(monitorEvents).values(values);
  }

  async findById(id: string): Promise<MonitorEventRow | undefined> {
    return this.db.query.monitorEvents.findFirst({
      where: eq(monitorEvents.id, id),
    });
  }

  async findBySourceKey(sourceKey: string): Promise<MonitorEventRow | undefined> {
    return this.db.query.monitorEvents.findFirst({
      where: eq(monitorEvents.sourceKey, sourceKey),
    });
  }
}
