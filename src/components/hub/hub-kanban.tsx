"use client";

import {
  Circle,
  CircleDot,
  CircleCheck,
  CircleX,
  CircleDashed,
  SignalHigh,
  SignalMedium,
  SignalLow,
  Signal,
  AlertTriangle,
  Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Issue = {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  priorityLabel: string;
  state: { id: string; name: string; color: string; type: string };
  labels: Array<{ id: string; name: string; color: string }>;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string; color?: string };
};

// Status name ordering for columns. Explicit names take priority;
// anything not listed falls back to type-based ordering.
const STATUS_NAME_ORDER: Record<string, number> = {
  "In Progress": 1,
  "Today": 2,
  "Blocked": 3,
  "Todo": 4,
  "In Review": 5,
  "Staging Review": 6,
  "Prod Review": 7,
  "Awaiting Feedback": 8,
  "Backlog": 9,
  "Done": 10,
  "Cancelled": 11,
  "Duplicate": 12,
};

const STATUS_TYPE_ORDER: Record<string, number> = {
  started: 20,
  unstarted: 30,
  backlog: 40,
  triage: 50,
  completed: 60,
  cancelled: 70,
};

function statusSortOrder(name: string, type?: string): number {
  return STATUS_NAME_ORDER[name] ?? STATUS_TYPE_ORDER[type ?? ""] ?? 99;
}

type GroupBy = "status" | "label";
type Column = {
  label: string;
  color: string;
  type: "status" | "label";
  statusType?: string;
  issues: Issue[];
};

export function HubKanban({
  issues,
  groupBy = "status",
  onIssueClick,
}: {
  issues: Issue[];
  groupBy?: GroupBy;
  onIssueClick?: (issueId: string) => void;
}) {
  let columns: [string, Column][];

  if (groupBy === "label") {
    const map = new Map<string, Column>();
    for (const issue of issues) {
      if (issue.labels.length === 0) {
        const key = "__no_label__";
        if (!map.has(key)) {
          map.set(key, { label: "No Label", color: "var(--muted-foreground)", type: "label", issues: [] });
        }
        map.get(key)!.issues.push(issue);
      } else {
        for (const lbl of issue.labels) {
          if (!map.has(lbl.id)) {
            map.set(lbl.id, { label: lbl.name, color: lbl.color, type: "label", issues: [] });
          }
          map.get(lbl.id)!.issues.push(issue);
        }
      }
    }
    columns = Array.from(map.entries()).sort(([keyA, a], [keyB, b]) => {
      if (keyA === "__no_label__") return 1;
      if (keyB === "__no_label__") return -1;
      return a.label.localeCompare(b.label);
    });
  } else {
    // Group by state
    const grouped = issues.reduce(
      (acc, issue) => {
        const key = issue.state.name;
        if (!acc[key]) {
          acc[key] = { label: issue.state.name, color: issue.state.color, type: "status", statusType: issue.state.type, issues: [] };
        }
        acc[key].issues.push(issue);
        return acc;
      },
      {} as Record<string, Column>
    );

    columns = Object.entries(grouped).sort(([, a], [, b]) => {
      return statusSortOrder(a.label, a.statusType) - statusSortOrder(b.label, b.statusType);
    });
  }

  if (issues.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm text-muted-foreground">No issues to display</p>
      </div>
    );
  }

  return (
    <div className="flex gap-1 pb-4 px-1">
      {columns.map(([key, column]) => (
        <div key={key} className="flex-shrink-0 w-80 sm:w-[356px]">
          {/* Column header */}
          <div className="flex items-center gap-2 px-3 pt-3 pb-2 sticky top-0 z-10 bg-background border-b border-border">
            {column.type === "status" ? (
              <StatusIcon type={column.statusType ?? ""} color={column.color} />
            ) : (
              <span
                className="w-3.5 h-3.5 rounded-full shrink-0"
                style={{ backgroundColor: column.color }}
              />
            )}
            <span className="text-sm font-medium text-foreground tracking-tight">
              {column.label}
            </span>
            <span className="px-2 py-0.5 bg-muted/60 rounded-full text-xs font-medium text-muted-foreground">
              {column.issues.length}
            </span>
          </div>

          {/* Cards */}
          <div className="space-y-2 px-1">
            {column.issues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                onClick={() => onIssueClick?.(issue.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function IssueCard({
  issue,
  onClick,
}: {
  issue: Issue;
  onClick: () => void;
}) {
  const isOverdue = issue.dueDate && new Date(issue.dueDate) < new Date();
  const isDueSoon =
    issue.dueDate &&
    !isOverdue &&
    new Date(issue.dueDate).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000;

  return (
    <button
      onClick={onClick}
      className="w-full bg-card border border-border/40 rounded-md hover:border-border/60 hover:shadow-sm transition-all duration-200 cursor-pointer text-left"
    >
      <div className="p-3">
        {/* Top row: identifier + status */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] font-mono text-muted-foreground/80 tracking-wider font-semibold">
            {issue.identifier}
          </span>
          <StatusIcon type={issue.state.type} color={issue.state.color} />
        </div>

        {/* Title */}
        <h4 className="text-sm font-medium text-foreground leading-tight tracking-tight line-clamp-2 mb-3">
          {issue.title}
        </h4>

        {/* Project badge */}
        {issue.project && (
          <div className="flex items-center gap-1 mb-2">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: issue.project.color || "var(--muted-foreground)" }}
            />
            <span className="text-[10px] text-muted-foreground truncate">
              {issue.project.name}
            </span>
          </div>
        )}

        {/* Bottom badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <PriorityBadge priority={issue.priority} />

          {issue.labels.map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted/50 text-muted-foreground"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
            </span>
          ))}

          {issue.dueDate && (
            <span
              className={cn(
                "flex items-center gap-1 text-[10px] tabular-nums",
                isOverdue
                  ? "text-destructive"
                  : isDueSoon
                    ? "text-yellow-500"
                    : "text-muted-foreground"
              )}
            >
              <Calendar className="w-3 h-3" />
              {formatShortDate(issue.dueDate)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function StatusIcon({ type, color }: { type: string; color: string }) {
  const style = { color: color || "var(--muted-foreground)" };
  const cls = "w-3.5 h-3.5 shrink-0";
  switch (type) {
    case "triage":
    case "backlog":
      return <CircleDashed className={cls} style={style} />;
    case "unstarted":
      return <Circle className={cls} style={style} />;
    case "started":
      return <CircleDot className={cls} style={style} />;
    case "completed":
      return <CircleCheck className={cls} style={style} />;
    case "cancelled":
      return <CircleX className={cls} style={style} />;
    default:
      return <Circle className={cls} style={style} />;
  }
}

function PriorityBadge({ priority }: { priority: number }) {
  const cls = "w-3 h-3";
  let icon;
  switch (priority) {
    case 1:
      icon = <AlertTriangle className={cn(cls, "text-orange-500")} />;
      break;
    case 2:
      icon = <SignalHigh className={cn(cls, "text-orange-400")} />;
      break;
    case 3:
      icon = <SignalMedium className={cn(cls, "text-yellow-500")} />;
      break;
    case 4:
      icon = <SignalLow className={cn(cls, "text-blue-400")} />;
      break;
    default:
      icon = <Signal className={cn(cls, "text-muted-foreground/40")} />;
      break;
  }
  return (
    <span className="inline-flex items-center px-1 py-0.5 rounded bg-muted/50">
      {icon}
    </span>
  );
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
