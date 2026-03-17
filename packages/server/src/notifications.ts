import type { MonitorNotificationRecord } from "./dao/monitorNotificationsDao.js";

export interface NotificationBroadcaster {
  publish(notification: MonitorNotificationRecord): void;
  subscribe(listener: (notification: MonitorNotificationRecord) => void): () => void;
}

export function createNotificationBroadcaster(): NotificationBroadcaster {
  const listeners = new Set<(notification: MonitorNotificationRecord) => void>();

  return {
    publish(notification) {
      for (const listener of listeners) {
        listener(notification);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
