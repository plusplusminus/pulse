"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";
import { Layers, FolderKanban, CircleDot, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { HubUpdates } from "./hub-updates";

type Tab = "projects" | "updates";

const TABS: { key: Tab; label: string }[] = [
  { key: "projects", label: "Projects" },
  { key: "updates", label: "Updates" },
];

type TeamCardData = {
  id: string;
  name: string;
  key: string;
  projectCount: number;
  openIssueCount: number;
  lastActivity: string | null;
};

export function HubTabs({
  teams,
  hubId,
  hubSlug,
}: {
  teams: TeamCardData[];
  hubId: string;
  hubSlug: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const activeTab = (searchParams.get("tab") as Tab) || "projects";

  function setTab(tab: Tab) {
    captureEvent(POSTHOG_EVENTS.tab_switched, { tab });
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "projects") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border shrink-0">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.key;
          const count =
            tab.key === "projects"
              ? teams.length
              : null;

          return (
            <button
              key={tab.key}
              onClick={() => setTab(tab.key)}
              className={cn(
                "relative px-3 py-2.5 text-xs font-medium transition-colors",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="flex items-center gap-1.5">
                {tab.label}
                {count !== null && (
                  <span
                    className={cn(
                      "tabular-nums text-[10px]",
                      isActive ? "text-foreground/60" : "text-muted-foreground/60"
                    )}
                  >
                    {count}
                  </span>
                )}
              </span>
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-foreground rounded-t-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "projects" && (
        <div className="pt-6">
          {teams.length === 0 ? (
            <div className="border border-border rounded-lg p-10 bg-card text-center">
              <Layers className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium mb-1">No projects configured</p>
              <p className="text-xs text-muted-foreground">
                No projects have been added to this hub yet. Contact your project
                manager.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {teams.map((team) => (
                <TeamCard
                  key={team.id}
                  name={team.name}
                  teamKey={team.key}
                  projectCount={team.projectCount}
                  openIssueCount={team.openIssueCount}
                  lastActivity={team.lastActivity}
                  href={`/hub/${hubSlug}/${team.key}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "updates" && (
        <div className="pt-6 max-w-4xl overflow-y-auto">
          <HubUpdates hubId={hubId} />
        </div>
      )}
    </div>
  );
}

function TeamCard({
  name,
  teamKey,
  projectCount,
  openIssueCount,
  lastActivity,
  href,
}: {
  name: string;
  teamKey: string;
  projectCount: number;
  openIssueCount: number;
  lastActivity: string | null;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="border border-border rounded-lg p-4 bg-card hover:bg-accent/50 hover:border-border/80 transition-colors group"
    >
      <div className="mb-3">
        <p className="text-sm font-medium group-hover:text-primary transition-colors truncate">
          {name}
        </p>
        <span className="text-[10px] font-mono text-muted-foreground">
          {teamKey}
        </span>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <FolderKanban className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs">
            {projectCount} {projectCount === 1 ? "epic" : "epics"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <CircleDot className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs">
            {openIssueCount} open{" "}
            {openIssueCount === 1 ? "task" : "tasks"}
          </span>
        </div>
        {lastActivity && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span className="text-xs">
              <RelativeTime dateStr={lastActivity} />
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

function RelativeTime({ dateStr }: { dateStr: string }) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return <>just now</>;
  if (diffMin < 60) return <>{diffMin}m ago</>;
  if (diffHr < 24) return <>{diffHr}h ago</>;
  if (diffDay < 30) return <>{diffDay}d ago</>;
  return <>{date.toLocaleDateString()}</>;
}
