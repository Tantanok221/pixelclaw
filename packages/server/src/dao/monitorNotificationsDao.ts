import { desc, eq } from "drizzle-orm";
import { monitorEvents, monitorNotifications, type MonitorNotificationRow } from "../schema.js";
import type { DatabaseClient } from "./shared.js";

export interface MonitorNotificationRecord {
  id: string;
  eventId: string;
  monitorId: string;
  provider: string;
  eventType: string;
  title: string;
  payload: unknown;
  sourceKey: string;
  status: string;
  createdAt: string;
  readAt: string | null;
}

export class MonitorNotificationsDao {
  constructor(private readonly db: DatabaseClient) {}

  async insert(values: MonitorNotificationRow): Promise<void> {
    await this.db.insert(monitorNotifications).values(values);
  }

  async findById(id: string): Promise<MonitorNotificationRow | undefined> {
    return this.db.query.monitorNotifications.findFirst({
      where: eq(monitorNotifications.id, id),
    });
  }

  async findByEventId(eventId: string): Promise<MonitorNotificationRow | undefined> {
    return this.db.query.monitorNotifications.findFirst({
      where: eq(monitorNotifications.monitorEventId, eventId),
    });
  }

  async listWithEvents(): Promise<MonitorNotificationRecord[]> {
    const rows = await this.db
      .select({
        id: monitorNotifications.id,
        eventId: monitorEvents.id,
        monitorId: monitorEvents.monitorId,
        provider: monitorEvents.provider,
        eventType: monitorEvents.type,
        title: monitorEvents.title,
        payload: monitorEvents.payload,
        sourceKey: monitorEvents.sourceKey,
        status: monitorNotifications.status,
        createdAt: monitorNotifications.createdAt,
        readAt: monitorNotifications.readAt,
      })
      .from(monitorNotifications)
      .innerJoin(monitorEvents, eq(monitorNotifications.monitorEventId, monitorEvents.id))
      .orderBy(desc(monitorNotifications.createdAt));

    return rows;
  }
}
