"use client";

import { useMemo } from "react";
import { Calendar, CalendarDays, CircleDot } from "lucide-react";

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
};

type Column = {
  label: string;
  color: string;
  projects: Project[];
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function RoadmapList({ projects }: { projects: Project[] }) {
  const columns = useMemo((): [string, Column][] => {
    const monthMap = new Map<string, Column>();
    const unscheduled: Project[] = [];

    for (const p of projects) {
      if (!p.targetDate) {
        unscheduled.push(p);
        continue;
      }
      const d = new Date(p.targetDate);
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth();
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const label = `${MONTH_NAMES[month]} ${year}`;

      if (!monthMap.has(key)) {
        monthMap.set(key, {
          label,
          color: "var(--muted-foreground)",
          projects: [],
        });
      }
      monthMap.get(key)!.projects.push(p);
    }

    // Sort months chronologically
    const sorted = Array.from(monthMap.entries()).sort(([a], [b]) =>
      a.localeCompare(b)
    );

    // Add unscheduled column at the end
    if (unscheduled.length > 0) {
      sorted.push([
        "__unscheduled__",
        {
          label: "Unscheduled",
          color: "var(--muted-foreground)",
          projects: unscheduled,
        },
      ]);
    }

    return sorted;
  }, [projects]);

  if (projects.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-muted-foreground">No projects to display</p>
      </div>
    );
  }

  return (
    <div className="flex gap-1 overflow-x-auto pb-4 px-1 snap-x snap-mandatory sm:snap-none">
      {columns.map(([key, column]) => (
        <div key={key} className="flex-shrink-0 w-72 sm:w-80 snap-start">
          {/* Column header */}
          <div className="flex items-center gap-2 p-3 mb-2">
            <CalendarDays
              className="w-3.5 h-3.5 shrink-0"
              style={{ color: column.color }}
            />
            <span className="text-sm font-medium text-foreground tracking-tight">
              {column.label}
            </span>
            <span className="px-2 py-0.5 bg-muted/60 rounded-full text-xs font-medium text-muted-foreground">
              {column.projects.length}
            </span>
          </div>

          {/* Cards */}
          <div className="space-y-2 px-1">
            {column.projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const progressPct = Math.max(0, Math.min(100, Math.round(project.progress * 100)));
  const color = project.color || project.status.color || "var(--primary)";

  return (
    <div className="bg-card border border-border/40 rounded-md hover:border-border/60 hover:shadow-sm transition-all duration-200">
      <div className="p-3">
        {/* Color dot + name */}
        <div className="flex items-center gap-2 mb-2">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <h4 className="text-sm font-medium text-foreground leading-tight truncate flex-1">
            {project.name}
          </h4>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progressPct}%`,
                backgroundColor: color,
              }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground w-7 text-right">
            {progressPct}%
          </span>
        </div>

        {/* Bottom badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/50 text-muted-foreground">
            <CircleDot className="w-2.5 h-2.5" style={{ color: project.status.color }} />
            {project.status.name}
          </span>

          {project.targetDate && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <Calendar className="w-3 h-3" />
              {formatDate(project.targetDate)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  // Parse as UTC to stay consistent with the UTC bucketing logic above
  const d = new Date(dateStr + (dateStr.includes("T") ? "" : "T00:00:00Z"));
  const day = d.getUTCDate();
  const month = MONTH_NAMES[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  return year !== currentYear ? `${month} ${day}, ${year}` : `${month} ${day}`;
}
