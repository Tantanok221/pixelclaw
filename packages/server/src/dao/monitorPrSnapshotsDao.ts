import { asc, eq, and } from "drizzle-orm";
import { monitorPrSnapshots, type MonitorPrSnapshotRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export class MonitorPrSnapshotsDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: MonitorPrSnapshotRow): Promise<void> {
    await this.db.insert(monitorPrSnapshots).values(values);
  }

  async findById(id: string): Promise<MonitorPrSnapshotRow | undefined> {
    return this.db.query.monitorPrSnapshots.findFirst({
      where: eq(monitorPrSnapshots.id, id),
    });
  }

  async findByMonitorAndPrNumber(monitorId: string, prNumber: number): Promise<MonitorPrSnapshotRow | undefined> {
    return this.db.query.monitorPrSnapshots.findFirst({
      where: and(eq(monitorPrSnapshots.monitorId, monitorId), eq(monitorPrSnapshots.prNumber, prNumber)),
    });
  }

  async listByMonitor(monitorId: string): Promise<MonitorPrSnapshotRow[]> {
    return this.db.query.monitorPrSnapshots.findMany({
      where: eq(monitorPrSnapshots.monitorId, monitorId),
      orderBy: asc(monitorPrSnapshots.prNumber),
    });
  }

  async updateById(id: string, patch: Partial<MonitorPrSnapshotRow>): Promise<void> {
    await this.db.update(monitorPrSnapshots).set(patch).where(eq(monitorPrSnapshots.id, id));
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(monitorPrSnapshots).where(eq(monitorPrSnapshots.id, id));
  }
}
