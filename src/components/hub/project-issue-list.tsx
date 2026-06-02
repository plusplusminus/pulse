"use client";

import { useState, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
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
  Filter,
  X,
  List,
  Columns3,
  Search,
  FolderKanban,
  Tag,
  IterationCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanInteract } from "@/hooks/use-can-interact";
import { IssueDetailPanel } from "./issue-detail-panel";
import { HubKanban } from "./hub-kanban";
import { CheckboxFilterDropdown } from "./filter-dropdown";

type Issue = {
  id: string;
  identifier: string;
  title: string;
  priority: number;
  priorityLabel: string;
  state: { id: string; name: string; color: string; type: string };
  labels: Array<{ id: string; name: string; color: string }>;
  cycle?: { id: string; name: string; number: number };
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  project?: { id: string; name: string; color?: string };
};

type ProjectInfo = { id: string; name: string; color?: string };

type FilterState = {
  search: string;
  statuses: string[];
  priorities: number[];
  labelIds: string[];
  projectIds: string[];
  cycleIds: string[];
};

type ViewMode = "list" | "kanban";
type GroupBy = "status" | "label";
type SortField = "priority" | "dueDate" | "createdAt";
type SortDir = "asc" | "desc";

// Status name ordering for grouping. Explicit names take priority;
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

export function ProjectIssueList({
  issues: initialIssues,
  states,
  labels,
  cycles,
  hubId,
  projectId,
  projects,
  isCycleView,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  teamId,
}: {
  issues: Issue[];
  states: Array<{ id: string; name: string; color: string; type: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  cycles?: Array<{ id: string; name: string; number: number; startsAt?: string | null; endsAt?: string | null }>;
  hubSlug: string;
  teamKey: string;
  teamId: string;
  projectId?: string;
  hubId: string;
  projects?: ProjectInfo[];
  isCycleView?: boolean;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const canInteract = useCanInteract();
  const isViewOnly = !canInteract;

  const [issues, setIssues] = useState(initialIssues);
  // Parse filters from URL
  const [filters, setFilters] = useState<FilterState>(() => ({
    search: searchParams.get("q") ?? "",
    statuses: searchParams.getAll("status"),
    priorities: searchParams.getAll("priority").map(Number).filter((n) => !isNaN(n)),
    labelIds: searchParams.getAll("label"),
    projectIds: searchParams.getAll("project"),
    cycleIds: searchParams.getAll("cycle"),
  }));

  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (searchParams.get("view") as ViewMode) || "list"
  );

  const [groupBy, setGroupBy] = useState<GroupBy>(
    () => (searchParams.get("groupBy") as GroupBy) || "status"
  );

  const [sort, setSort] = useState<{ field: SortField; dir: SortDir }>({
    field: "priority",
    dir: "asc",
  });

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(
    filters.statuses.length > 0 ||
      filters.priorities.length > 0 ||
      filters.labelIds.length > 0 ||
      filters.projectIds.length > 0 ||
      filters.cycleIds.length > 0
  );
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);

  // Update URL params when filters/view/groupBy change
  function updateUrl(next: FilterState, view: ViewMode, group: GroupBy = groupBy) {
    const params = new URLSearchParams(window.location.search);
    // Preserve tab param
    const tab = params.get("tab");
    const newParams = new URLSearchParams();
    if (tab) newParams.set("tab", tab);
    if (next.search) newParams.set("q", next.search);
    next.statuses.forEach((s) => newParams.append("status", s));
    next.priorities.forEach((p) => newParams.append("priority", String(p)));
    next.labelIds.forEach((l) => newParams.append("label", l));
    next.projectIds.forEach((id) => newParams.append("project", id));
    next.cycleIds.forEach((id) => newParams.append("cycle", id));
    if (view !== "list") newParams.set("view", view);
    if (group !== "status") newParams.set("groupBy", group);
    const qs = newParams.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }

  function updateFilters(next: FilterState) {
    setFilters(next);
    updateUrl(next, viewMode);
  }

  function changeView(view: ViewMode) {
    setViewMode(view);
    updateUrl(filters, view);
  }

  function changeGroupBy(group: GroupBy) {
    setGroupBy(group);
    setCollapsedGroups(new Set());
    updateUrl(filters, viewMode, group);
  }

  // Filter issues
  const filtered = useMemo(() => {
    return issues.filter((issue) => {
      // Text search
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (
          !issue.title.toLowerCase().includes(q) &&
          !issue.identifier.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (
        filters.statuses.length > 0 &&
        !filters.statuses.includes(issue.state.name)
      )
        return false;
      if (
        filters.priorities.length > 0 &&
        !filters.priorities.includes(issue.priority)
      )
        return false;
      if (
        filters.labelIds.length > 0 &&
        !issue.labels.some((l) => filters.labelIds.includes(l.id))
      )
        return false;
      if (
        filters.projectIds.length > 0 &&
        (!issue.project || !filters.projectIds.includes(issue.project.id))
      )
        return false;
      if (
        filters.cycleIds.length > 0 &&
        (!issue.cycle || !filters.cycleIds.includes(issue.cycle.id))
      )
        return false;
      return true;
    });
  }, [issues, filters]);

  // Sort issues within groups
  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sort.field) {
        case "priority":
          cmp = a.priority - b.priority;
          break;
        case "dueDate": {
          const da = a.dueDate ?? "9999";
          const db = b.dueDate ?? "9999";
          cmp = da.localeCompare(db);
          break;
        }
        case "createdAt":
          cmp = a.createdAt.localeCompare(b.createdAt);
          break;
      }
      return sort.dir === "desc" ? -cmp : cmp;
    });
    return copy;
  }, [filtered, sort]);

  // Group issues by status or label
  type GroupInfo = {
    label: string;
    color: string;
    type: "status" | "label";
    statusType?: string;
    issues: Issue[];
  };

  const groups = useMemo((): [string, GroupInfo][] => {
    if (groupBy === "label") {
      const map = new Map<string, GroupInfo>();

      for (const issue of sorted) {
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

      // Sort: named labels alphabetically, "No Label" last
      return Array.from(map.entries()).sort(([keyA, a], [keyB, b]) => {
        if (keyA === "__no_label__") return 1;
        if (keyB === "__no_label__") return -1;
        return a.label.localeCompare(b.label);
      });
    }

    // Default: group by status
    const map = new Map<string, GroupInfo>();
    for (const issue of sorted) {
      const key = issue.state.name;
      if (!map.has(key)) {
        map.set(key, {
          label: issue.state.name,
          color: issue.state.color,
          type: "status",
          statusType: issue.state.type,
          issues: [],
        });
      }
      map.get(key)!.issues.push(issue);
    }

    return Array.from(map.entries()).sort(([, a], [, b]) => {
      return statusSortOrder(a.label, a.statusType) - statusSortOrder(b.label, b.statusType);
    });
  }, [sorted, groupBy]);

  const hasActiveFilters =
    filters.search.length > 0 ||
    filters.statuses.length > 0 ||
    filters.priorities.length > 0 ||
    filters.labelIds.length > 0 ||
    filters.projectIds.length > 0 ||
    filters.cycleIds.length > 0;

  const activeFilterCount =
    filters.statuses.length + filters.priorities.length + filters.labelIds.length + filters.projectIds.length + filters.cycleIds.length;

  function toggleGroup(name: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleSort(field: SortField) {
    setSort((prev) =>
      prev.field === field
        ? { field, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { field, dir: "asc" }
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar: search, filters, view toggle, sort */}
      <div className="px-6 py-2 border-b border-border flex items-center gap-2 shrink-0">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={filters.search}
            onChange={(e) => updateFilters({ ...filters, search: e.target.value })}
            className="pl-7 pr-2 py-1 w-40 rounded-md border border-border bg-background text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors",
            showFilters || activeFilterCount > 0
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          Filter
          {activeFilterCount > 0 && (
            <span className="ml-0.5 px-1 py-0 rounded bg-primary text-primary-foreground text-[10px]">
              {activeFilterCount}
            </span>
          )}
        </button>

        {hasActiveFilters && (
          <button
            onClick={() =>
              updateFilters({ search: "", statuses: [], priorities: [], labelIds: [], projectIds: [], cycleIds: [] })
            }
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}

        <div className="flex-1" />

        {/* Group by toggle */}
        {labels.length > 0 && (
          <div className="flex items-center border border-border rounded-md overflow-hidden">
            <button
              onClick={() => changeGroupBy("status")}
              aria-pressed={groupBy === "status"}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs transition-colors",
                groupBy === "status"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Group by status"
            >
              <CircleDot className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => changeGroupBy("label")}
              aria-pressed={groupBy === "label"}
              className={cn(
                "flex items-center gap-1 px-2 py-1 text-xs transition-colors",
                groupBy === "label"
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Group by label"
            >
              <Tag className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* View toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden">
          <button
            onClick={() => changeView("list")}
            aria-pressed={viewMode === "list"}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs transition-colors",
              viewMode === "list"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <List className="w-3.5 h-3.5" />
            List
          </button>
          <button
            onClick={() => changeView("kanban")}
            aria-pressed={viewMode === "kanban"}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs transition-colors",
              viewMode === "kanban"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Columns3 className="w-3.5 h-3.5" />
            Board
          </button>
        </div>

        {/* Sort controls (list view only) */}
        {viewMode === "list" && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-1">Sort:</span>
            {(["priority", "dueDate", "createdAt"] as SortField[]).map((field) => (
              <button
                key={field}
                onClick={() => toggleSort(field)}
                className={cn(
                  "px-1.5 py-0.5 rounded text-[10px] transition-colors",
                  sort.field === field
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {field === "priority"
                  ? "Priority"
                  : field === "dueDate"
                    ? "Due"
                    : "Created"}
                {sort.field === field && (sort.dir === "asc" ? " \u2191" : " \u2193")}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filter chips */}
      {showFilters && (
        <div className="px-6 py-2 border-b border-border flex flex-wrap gap-3 shrink-0">
          {/* Status filter */}
          <CheckboxFilterDropdown
            items={states.map((s) => ({ id: s.name, name: s.name, color: s.color }))}
            selected={filters.statuses}
            onChange={(next) => updateFilters({ ...filters, statuses: next })}
            label="Status"
            icon={<CircleDot className="w-3 h-3" />}
          />

          {/* Priority filter */}
          <CheckboxFilterDropdown
            items={[1, 2, 3, 4, 0].map((p) => ({ id: String(p), name: priorityLabel(p) }))}
            selected={filters.priorities.map(String)}
            onChange={(next) => updateFilters({ ...filters, priorities: next.map(Number) })}
            label="Priority"
            icon={<SignalHigh className="w-3 h-3" />}
          />

          {/* Project filter (team-level view only) */}
          {projects && projects.length > 0 && (
            <CheckboxFilterDropdown
              items={projects.map((p) => ({ id: p.id, name: p.name, color: p.color }))}
              selected={filters.projectIds}
              onChange={(next) => updateFilters({ ...filters, projectIds: next })}
              label="Epic"
              icon={<FolderKanban className="w-3 h-3" />}
            />
          )}

          {/* Label filter */}
          {labels.length > 0 && (
            <CheckboxFilterDropdown
              items={labels.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
              selected={filters.labelIds}
              onChange={(next) => updateFilters({ ...filters, labelIds: next })}
              label="Label"
              icon={<Tag className="w-3 h-3" />}
            />
          )}

          {/* Cycle filter */}
          {cycles && cycles.length > 0 && (
            <CheckboxFilterDropdown
              items={cycles.map((c) => ({
                id: c.id,
                name: c.name || `Cycle ${c.number}`,
                description: formatCycleDateRange(c.startsAt, c.endsAt),
              }))}
              selected={filters.cycleIds}
              onChange={(next) => updateFilters({ ...filters, cycleIds: next })}
              label="Cycle"
              icon={<IterationCw className="w-3 h-3" />}
            />
          )}
        </div>
      )}

      {/* Content area */}
      {viewMode === "kanban" ? (
        <div className="flex-1 overflow-x-auto overflow-y-auto px-4 pb-4">
          <HubKanban issues={sorted} groupBy={groupBy} onIssueClick={setSelectedIssueId} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm text-muted-foreground">
                {hasActiveFilters
                  ? "No tasks match the current filters"
                  : isCycleView
                    ? "No tasks in this cycle"
                    : projectId
                      ? "No tasks in this epic"
                      : "No tasks in this project"}
              </p>
            </div>
          ) : (
            groups.map(([groupKey, group]) => {
              const isCollapsed = collapsedGroups.has(groupKey);
              return (
                <div key={groupKey}>
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(groupKey)}
                    className="w-full flex items-center gap-2 px-6 py-2 text-xs font-medium hover:bg-accent/30 transition-colors sticky top-0 bg-background z-10 border-b border-border"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                    {group.type === "status" ? (
                      <StatusIcon type={group.statusType ?? ""} color={group.color} />
                    ) : (
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: group.color }}
                      />
                    )}
                    <span>{group.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {group.issues.length}
                    </span>
                  </button>

                  {/* Issue rows */}
                  {!isCollapsed &&
                    group.issues.map((issue) => (
                      <IssueRow
                        key={issue.id}
                        issue={issue}
                        selected={selectedIssueId === issue.id}
                        onClick={() => setSelectedIssueId(issue.id)}
                      />
                    ))}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Issue detail panel */}
      <IssueDetailPanel
        issueId={selectedIssueId}
        hubId={hubId}
        isViewOnly={isViewOnly}
        onClose={() => setSelectedIssueId(null)}
        onIssueUpdate={(id, patch) => {
          setIssues((prev) =>
            prev.map((i) => (i.id === id ? { ...i, ...patch } : i))
          );
        }}
      />

    </div>
  );
}

// -- Sub-components ──────────────────────────────────────────────────────────

function IssueRow({
  issue,
  selected,
  onClick,
}: {
  issue: Issue;
  selected: boolean;
  onClick: () => void;
}) {
  const isOverdue =
    issue.dueDate && new Date(issue.dueDate) < new Date();
  const isDueSoon =
    issue.dueDate &&
    !isOverdue &&
    new Date(issue.dueDate).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000;

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-6 py-2 text-left hover:bg-accent/30 transition-colors border-b border-border/50",
        selected && "bg-accent/50"
      )}
    >
      <StatusIcon type={issue.state.type} color={issue.state.color} />
      <span className="text-[11px] font-mono text-muted-foreground shrink-0 w-16">
        {issue.identifier}
      </span>
      <span className="text-sm truncate flex-1 min-w-0">{issue.title}</span>
      {issue.project && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground bg-muted/50 shrink-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: issue.project.color || "var(--muted-foreground)" }}
          />
          {issue.project.name}
        </span>
      )}
      {issue.cycle && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-muted-foreground bg-muted/50 border border-border/50 shrink-0">
          <IterationCw className="w-2.5 h-2.5" />
          {issue.cycle.name || `Cycle ${issue.cycle.number}`}
        </span>
      )}
      {issue.labels.length > 0 && (
        <div className="flex items-center gap-1 shrink-0">
          {issue.labels.slice(0, 3).map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium text-white/90"
              style={{ backgroundColor: label.color || "var(--muted)" }}
            >
              {label.name}
            </span>
          ))}
          {issue.labels.length > 3 && (
            <span className="text-[10px] text-muted-foreground">
              +{issue.labels.length - 3}
            </span>
          )}
        </div>
      )}
      <PriorityIcon priority={issue.priority} />
      {issue.dueDate && (
        <span
          className={cn(
            "flex items-center gap-1 text-[10px] tabular-nums shrink-0",
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

function PriorityIcon({ priority }: { priority: number }) {
  const cls = "w-3.5 h-3.5 shrink-0";
  switch (priority) {
    case 1:
      return <AlertTriangle className={cn(cls, "text-orange-500")} />;
    case 2:
      return <SignalHigh className={cn(cls, "text-orange-400")} />;
    case 3:
      return <SignalMedium className={cn(cls, "text-yellow-500")} />;
    case 4:
      return <SignalLow className={cn(cls, "text-blue-400")} />;
    default:
      return <Signal className={cn(cls, "text-muted-foreground/40")} />;
  }
}


function priorityLabel(p: number): string {
  switch (p) {
    case 1: return "Urgent";
    case 2: return "High";
    case 3: return "Medium";
    case 4: return "Low";
    default: return "None";
  }
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCycleDateRange(
  startsAt?: string | null,
  endsAt?: string | null
): string | undefined {
  if (!startsAt || !endsAt) return undefined;
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(startsAt)} – ${fmt(endsAt)}`;
}
