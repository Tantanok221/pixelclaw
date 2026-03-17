import { BellRing } from "lucide-react";
import { formatTime } from "../../helpers/monitor-format.js";
import type { MonitorNotification } from "../../lib/monitor-client.js";

interface NotificationBarProps {
  notifications: MonitorNotification[];
}

const VISIBLE_NOTIFICATIONS = 3;

export function NotificationBar({ notifications }: NotificationBarProps) {
  const unreadNotifications = notifications.filter((notification) => notification.status === "unread");

  if (!unreadNotifications.length) {
    return null;
  }

  const visibleNotifications = unreadNotifications.slice(0, VISIBLE_NOTIFICATIONS);
  const unreadLabel = unreadNotifications.length === 1 ? "1 unread alert" : `${unreadNotifications.length} unread alerts`;

  return (
    <div className="border-b border-border bg-card/80 px-6 py-4 backdrop-blur lg:px-8">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            <BellRing className="size-3.5" />
            <span>Status bar</span>
          </div>
          <span className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground">
            {unreadLabel}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {visibleNotifications.map((notification) => (
            <div
              key={notification.id}
              className="min-w-[240px] rounded-2xl border border-border bg-background px-4 py-3"
            >
              <p className="text-sm font-medium">{notification.title}</p>
              <p className="mt-2 text-xs text-muted-foreground">{formatTime(notification.createdAt)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
