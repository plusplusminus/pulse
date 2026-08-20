"use client";

import { useHub } from "@/contexts/hub-context";
import { FolderKanban, CircleDot, Clock } from "lucide-react";

type HubWelcomeProps = {
  stats: {
    epicCount: number;
    openTaskCount: number;
    lastActivity: string | null;
  };
};

export function HubWelcome({ stats }: HubWelcomeProps) {
  const { firstName, isLoading } = useHub();

  const now = new Date();
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const name = firstName || undefined;

  return (
    <div className="mb-6">
      <p className="text-xs text-muted-foreground mb-1">{dateStr}</p>
      <h1 className="text-2xl font-semibold tracking-tight">
        {isLoading ? (
          <span className="inline-block h-8 w-48 animate-pulse rounded bg-muted" />
        ) : (
          <>
            {greeting}
            {name ? `, ${name}` : ""}
          </>
        )}
      </h1>
      <p className="text-xs text-muted-foreground mt-1">
        Here&apos;s what&apos;s happening across your projects
      </p>

      <div className="flex items-center gap-3 mt-3">
        <Pill icon={FolderKanban}>
          {stats.epicCount} {stats.epicCount === 1 ? "epic" : "epics"}
        </Pill>
        <Pill icon={CircleDot}>
          {stats.openTaskCount} open {stats.openTaskCount === 1 ? "task" : "tasks"}
        </Pill>
        <Pill icon={Clock}>
          {stats.lastActivity
            ? `Last task activity ${formatRelative(stats.lastActivity)}`
            : "No task activity yet"}
        </Pill>
      </div>
    </div>
  );
}

function Pill({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground">
      <Icon className="w-3 h-3 shrink-0" />
      {children}
    </span>
  );
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "unknown";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return "just now";

  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
