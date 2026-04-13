"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";
import {
  Bell,
  MessageSquare,
  ArrowRight,
  FolderPlus,
  Folder,
  RefreshCw,
  Flag,
  Loader2,
  CheckCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationEvent = {
  id: string;
  hub_id: string;
  team_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor_name: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
  read: boolean;
};

const EVENT_TYPE_ICONS: Record<string, LucideIcon> = {
  comment: MessageSquare,
  status_change: ArrowRight,
  new_issue: FolderPlus,
  project_update: Folder,
  cycle_update: RefreshCw,
  initiative_update: Flag,
};

function formatRelativeTime(dateStr: string): string {
  const diff = Math.floor(
    (Date.now() - new Date(dateStr).getTime()) / 1000
  );
  if (diff < 60) return "just now";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function NotificationBell({
  hubId,
  hubSlug,
}: {
  hubId: string;
  hubSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [events, setEvents] = useState<NotificationEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Poll unread count every 30s
  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/hub/${hubId}/notifications/unread-count`
      );
      if (!res.ok) return;
      const data = (await res.json()) as { count: number };
      setUnreadCount(data.count);
    } catch {
      // Non-critical
    }
  }, [hubId]);

  useEffect(() => {
    fetchUnreadCount();
    const id = setInterval(fetchUnreadCount, 30_000);
    return () => clearInterval(id);
  }, [fetchUnreadCount]);

  // Fetch events when popover opens
  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const res = await fetch(
        `/api/hub/${hubId}/notifications?limit=10`
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        events: NotificationEvent[];
      };
      setEvents(data.events);
    } catch {
      // Non-critical
    } finally {
      setLoadingEvents(false);
    }
  }, [hubId]);

  useEffect(() => {
    if (open) fetchEvents();
  }, [open, fetchEvents]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  // Mark single event as read (optimistic)
  function markAsRead(eventId: string) {
    setEvents((prev) =>
      prev.map((e) => (e.id === eventId ? { ...e, read: true } : e))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    fetch(`/api/hub/${hubId}/notifications/mark-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventIds: [eventId] }),
    }).catch(() => {
      // Revert on failure
      setEvents((prev) =>
        prev.map((e) => (e.id === eventId ? { ...e, read: false } : e))
      );
      setUnreadCount((prev) => prev + 1);
    });
  }

  // Mark all as read (optimistic)
  async function markAllAsRead() {
    setMarkingAll(true);
    const previousEvents = events;
    const previousCount = unreadCount;

    setEvents((prev) => prev.map((e) => ({ ...e, read: true })));
    setUnreadCount(0);

    try {
      const res = await fetch(
        `/api/hub/${hubId}/notifications/mark-read`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ all: true }),
        }
      );
      if (!res.ok) throw new Error();
    } catch {
      // Revert on failure
      setEvents(previousEvents);
      setUnreadCount(previousCount);
    } finally {
      setMarkingAll(false);
    }
  }

  const displayCount = unreadCount > 9 ? "9+" : String(unreadCount);

  return (
    <div ref={containerRef} className="relative">
      {/* Bell trigger */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="relative p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-medium leading-none">
            {displayCount}
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-[360px] max-h-[480px] flex flex-col rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
            <span className="text-sm font-medium text-foreground">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                disabled={markingAll}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all as read
              </button>
            )}
          </div>

          {/* Event list */}
          <div className="flex-1 overflow-y-auto">
            {loadingEvents ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Loading...
              </div>
            ) : events.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              events.map((event) => (
                <NotificationItem
                  key={event.id}
                  event={event}
                  hubSlug={hubSlug}
                  onRead={() => {
                    if (!event.read) markAsRead(event.id);
                    captureEvent(POSTHOG_EVENTS.notification_clicked, {
                      eventType: event.event_type,
                      wasUnread: !event.read,
                    });
                    setOpen(false);
                  }}
                />
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-border text-xs shrink-0">
            <Link
              href={`/hub/${hubSlug}`}
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setOpen(false)}
            >
              View all activity
            </Link>
            <Link
              href={`/hub/${hubSlug}/settings`}
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setOpen(false)}
            >
              Notification settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationItem({
  event,
  hubSlug,
  onRead,
}: {
  event: NotificationEvent;
  hubSlug: string;
  onRead: () => void;
}) {
  const Icon = EVENT_TYPE_ICONS[event.event_type] ?? Bell;

  // Construct a link based on entity type + metadata
  const href = getEventHref(event, hubSlug);

  const content = (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-2.5 transition-colors cursor-pointer",
        "hover:bg-accent/50",
        !event.read && "bg-accent/20"
      )}
      onClick={onRead}
    >
      {/* Icon */}
      <div className="mt-0.5 shrink-0">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug line-clamp-2">
          {event.summary}
        </p>
        <div className="flex items-center gap-2 mt-1">
          {event.actor_name && (
            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
              {event.actor_name}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(event.created_at)}
          </span>
        </div>
      </div>

      {/* Unread dot */}
      {!event.read && (
        <div className="mt-2 shrink-0">
          <div className="w-2 h-2 rounded-full bg-primary" />
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }

  return content;
}

function getEventHref(
  event: NotificationEvent,
  hubSlug: string
): string | null {
  const meta = event.metadata as Record<string, string | undefined>;
  const teamKey = meta.team_key;

  switch (event.entity_type) {
    case "issue":
      if (teamKey) {
        return `/hub/${hubSlug}/${teamKey}?issue=${event.entity_id}`;
      }
      return null;
    case "comment": {
      const commentIssueId = meta._issue_id ?? meta.issue_id;
      if (commentIssueId && teamKey) {
        return `/hub/${hubSlug}/${teamKey}?issue=${commentIssueId}`;
      }
      return null;
    }
    case "project":
      if (teamKey) {
        return `/hub/${hubSlug}/${teamKey}/projects/${event.entity_id}`;
      }
      return null;
    default:
      return null;
  }
}
