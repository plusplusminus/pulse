"use client";

import { useState } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { List, Columns3, Calendar, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoadmapBoard } from "./roadmap-board";

type Project = {
  id: string;
  name: string;
  color?: string;
  progress: number;
  startDate?: string;
  priority: number;
  priorityLabel: string;
  labels: Array<{ id: string; name: string; color: string }>;
  status: { name: string; color: string; type: string };
  targetDate?: string;
  teams: Array<{ id: string }>;
  milestones: Array<{
    id: string;
    name: string;
    targetDate?: string;
  }>;
};

type EpicsViewMode = "list" | "board";

export function EpicsView({
  projects,
  hubSlug,
  teamKey,
}: {
  projects: Project[];
  hubSlug: string;
  teamKey: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [viewMode, setViewMode] = useState<EpicsViewMode>(() => {
    const v = searchParams.get("epicsView");
    return v === "board" ? "board" : "list";
  });

  function changeView(v: EpicsViewMode) {
    setViewMode(v);
    const params = new URLSearchParams(searchParams.toString());
    if (v === "list") params.delete("epicsView");
    else params.set("epicsView", v);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  const hrefFor = (id: string) => `/hub/${hubSlug}/${teamKey}/projects/${id}`;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="px-3 sm:px-6 py-2 border-b border-border flex items-center gap-2 shrink-0">
        <div className="flex-1" />

        {/* View toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden">
          <button
            onClick={() => changeView("list")}
            aria-label="List view"
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs transition-colors",
              viewMode === "list"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">List</span>
          </button>
          <button
            onClick={() => changeView("board")}
            aria-label="Board view"
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs transition-colors",
              viewMode === "board"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Columns3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Board</span>
          </button>
        </div>
      </div>

      {/* Content */}
      {projects.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-sm text-muted-foreground">No epics to display</p>
        </div>
      ) : viewMode === "board" ? (
        <div className="flex-1 overflow-x-auto overflow-y-auto p-4">
          <RoadmapBoard projects={projects} groupBy="status" getHref={hrefFor} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl space-y-2">
            {projects.map((project) => (
              <EpicListCard
                key={project.id}
                project={project}
                href={hrefFor(project.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EpicListCard({
  project,
  href,
}: {
  project: {
    id: string;
    name: string;
    color?: string;
    progress: number;
    status: { name: string; color: string; type: string };
    targetDate?: string;
  };
  href: string;
}) {
  const progressPct = Math.round(project.progress * 100);

  return (
    <Link
      href={href}
      className="flex items-center gap-3 border border-border rounded-lg px-4 py-3 bg-card hover:bg-accent/50 transition-colors group"
    >
      <div
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{
          backgroundColor:
            project.color ||
            project.status.color ||
            "var(--muted-foreground)",
        }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium group-hover:text-primary transition-colors truncate">
          {project.name}
        </p>
        <StatusBadge status={project.status} />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progressPct}%`,
              backgroundColor:
                project.color ||
                project.status.color ||
                "var(--primary)",
            }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground w-7 text-right">
          {progressPct}%
        </span>
      </div>
      {project.targetDate && (
        <div className="flex items-center gap-1 text-muted-foreground shrink-0">
          <Calendar className="w-3 h-3" />
          <span className="text-[10px] tabular-nums">
            {formatDate(project.targetDate)}
          </span>
        </div>
      )}
    </Link>
  );
}

function StatusBadge({
  status,
}: {
  status: { name: string; color: string; type: string };
}) {
  return (
    <span className="inline-flex items-center gap-1 mt-0.5">
      <CircleDot
        className="w-3 h-3"
        style={{ color: status.color || "var(--muted-foreground)" }}
      />
      <span className="text-[10px] text-muted-foreground">{status.name}</span>
    </span>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}
