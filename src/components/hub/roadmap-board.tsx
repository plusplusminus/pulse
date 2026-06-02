"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Calendar, CircleDot } from "lucide-react";

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

type BoardGroupBy = "status" | "priority" | "label";

type Column = {
  label: string;
  color: string;
  projects: Project[];
};

const STATUS_COLUMNS = [
  { key: "planned", label: "Planned", type: "planned" },
  { key: "started", label: "Started", type: "started" },
  { key: "paused", label: "Paused", type: "paused" },
  { key: "completed", label: "Completed", type: "completed" },
  { key: "cancelled", label: "Cancelled", type: "cancelled" },
];

const PRIORITY_COLUMNS = [
  { key: "1", label: "Urgent", color: "#f97316" },
  { key: "2", label: "High", color: "#fb923c" },
  { key: "3", label: "Medium", color: "#eab308" },
  { key: "4", label: "Low", color: "#60a5fa" },
  { key: "0", label: "No Priority", color: "var(--muted-foreground)" },
];

export function RoadmapBoard({
  projects,
  groupBy,
  getHref,
}: {
  projects: Project[];
  groupBy: BoardGroupBy;
  getHref?: (projectId: string) => string;
}) {
  const columns = useMemo((): [string, Column][] => {
    if (groupBy === "priority") {
      const map = new Map<string, Column>();
      for (const col of PRIORITY_COLUMNS) {
        map.set(col.key, { label: col.label, color: col.color, projects: [] });
      }
      for (const p of projects) {
        const key = String(p.priority);
        const col = map.get(key);
        if (col) col.projects.push(p);
        else {
          if (!map.has(key)) map.set(key, { label: `Priority ${key}`, color: "var(--muted-foreground)", projects: [] });
          map.get(key)!.projects.push(p);
        }
      }
      return Array.from(map.entries()).filter(([, c]) => c.projects.length > 0);
    }

    if (groupBy === "label") {
      const map = new Map<string, Column>();
      for (const p of projects) {
        if (p.labels.length === 0) {
          const key = "__no_label__";
          if (!map.has(key)) map.set(key, { label: "No Label", color: "var(--muted-foreground)", projects: [] });
          map.get(key)!.projects.push(p);
        } else {
          for (const lbl of p.labels) {
            if (!map.has(lbl.id)) map.set(lbl.id, { label: lbl.name, color: lbl.color, projects: [] });
            map.get(lbl.id)!.projects.push(p);
          }
        }
      }
      return Array.from(map.entries()).sort(([keyA, a], [keyB, b]) => {
        if (keyA === "__no_label__") return 1;
        if (keyB === "__no_label__") return -1;
        return a.label.localeCompare(b.label);
      });
    }

    // Default: group by status
    const map = new Map<string, Column>();
    for (const col of STATUS_COLUMNS) {
      map.set(col.key, { label: col.label, color: "var(--muted-foreground)", projects: [] });
    }
    for (const p of projects) {
      const statusType = p.status.type || "planned";
      const col = map.get(statusType);
      if (col) {
        col.color = p.status.color || col.color;
        col.projects.push(p);
      } else {
        if (!map.has(statusType)) map.set(statusType, { label: p.status.name, color: p.status.color, projects: [] });
        map.get(statusType)!.projects.push(p);
      }
    }
    return Array.from(map.entries()).filter(([, c]) => c.projects.length > 0);
  }, [projects, groupBy]);

  if (projects.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-muted-foreground">No projects to display</p>
      </div>
    );
  }

  return (
    <div className="flex gap-1 overflow-x-auto pb-4 px-1">
      {columns.map(([key, column]) => (
        <div key={key} className="flex-shrink-0 w-72 sm:w-80">
          {/* Column header */}
          <div className="flex items-center gap-2 p-3 mb-2">
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0"
              style={{ backgroundColor: column.color }}
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
              <ProjectCard
                key={project.id}
                project={project}
                href={getHref?.(project.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProjectCard({ project, href }: { project: Project; href?: string }) {
  const progressPct = Math.round(project.progress * 100);
  const color = project.color || project.status.color || "var(--primary)";

  const cardClass =
    "block bg-card border border-border/40 rounded-md hover:border-border/60 hover:shadow-sm transition-all duration-200";

  const inner = (
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
  );

  return href ? (
    <Link href={href} className={cardClass}>
      {inner}
    </Link>
  ) : (
    <div className={cardClass}>{inner}</div>
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
