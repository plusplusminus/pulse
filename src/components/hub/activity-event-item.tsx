"use client";

import {
  MessageSquare,
  ArrowRightLeft,
  FilePlus,
  FolderOpen,
  RefreshCw,
  Flag,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NotificationEvent = {
  id: string;
  hub_id: string;
  team_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  actor_name: string | null;
  summary: string;
  metadata: Record<string, string> | null;
  created_at: string;
  read: boolean;
};

const EVENT_ICONS: Record<string, typeof MessageSquare> = {
  comment: MessageSquare,
  status_change: ArrowRightLeft,
  new_issue: FilePlus,
  project_update: FolderOpen,
  cycle_update: RefreshCw,
  initiative_update: Flag,
};

function getEntityUrl(
  hubSlug: string,
  event: NotificationEvent
): string | null {
  const meta = event.metadata || {};
  const teamKey = meta.team_key;

  // Keep the Activity tab active so the details panel opens in-place instead
  // of switching to the Tasks tab.
  if (event.entity_type === "issue" && teamKey) {
    return `/hub/${hubSlug}/${teamKey}?tab=activity&issue=${event.entity_id}`;
  }
  if (event.entity_type === "project" && teamKey) {
    return `/hub/${hubSlug}/${teamKey}/projects/${event.entity_id}`;
  }
  if (event.entity_type === "cycle" && teamKey) {
    return `/hub/${hubSlug}/${teamKey}/cycles/${event.entity_id}`;
  }
  if (event.entity_type === "comment" && meta.issue_id && teamKey) {
    return `/hub/${hubSlug}/${teamKey}?tab=activity&issue=${meta.issue_id}`;
  }
  return null;
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ActivityEventItem({
  event,
  hubSlug,
  hubId,
  onMarkRead,
}: {
  event: NotificationEvent;
  hubSlug: string;
  hubId: string;
  onMarkRead?: (eventId: string) => void;
}) {
  const Icon = EVENT_ICONS[event.event_type] || MessageSquare;
  const url = getEntityUrl(hubSlug, event);

  function handleClick() {
    if (!event.read && onMarkRead) {
      onMarkRead(event.id);
      // Fire and forget
      fetch(`/api/hub/${hubId}/notifications/mark-read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventIds: [event.id] }),
      }).catch(() => {});
    }
  }

  const content = (
    <div
      className={cn(
        "flex items-start gap-3 px-4 py-3 transition-colors",
        !event.read && "border-l-2 border-l-primary/60 bg-primary/[0.02]",
        event.read && "border-l-2 border-l-transparent",
        url && "cursor-pointer hover:bg-accent/50"
      )}
      onClick={handleClick}
    >
      <div className="mt-0.5 shrink-0">
        <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug">
          {event.actor_name && (
            <span className="font-medium">{event.actor_name} </span>
          )}
          <span className="text-muted-foreground">{event.summary}</span>
        </p>
        <span className="text-[10px] text-muted-foreground/70 mt-0.5 block">
          {relativeTime(event.created_at)}
        </span>
      </div>
      {!event.read && (
        <div className="mt-1.5 shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
        </div>
      )}
    </div>
  );

  if (url) {
    return (
      <a href={url} className="block no-underline text-inherit" onClick={handleClick}>
        {content}
      </a>
    );
  }

  return content;
}
