"use client";

import { useMemo } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";
import {
  Target,
  Flag,
  Calendar,
  CircleDot,
  IterationCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CycleCardPills } from "./cycle-card-pills";
import { ProjectIssueList } from "./project-issue-list";
import { ActivityFeed } from "./activity-feed";
import { IssueDetailPanel } from "./issue-detail-panel";
import { useCanInteract } from "@/hooks/use-can-interact";
import { RoadmapView } from "./roadmap-view";

type Tab = "issues" | "projects" | "roadmap" | "cycles" | "initiatives" | "milestones" | "activity";

const TABS: { key: Tab; label: string }[] = [
  { key: "issues", label: "Tasks" },
  { key: "projects", label: "Epics" },
  { key: "roadmap", label: "Roadmap" },
  { key: "cycles", label: "Cycles" },
  { key: "initiatives", label: "Initiatives" },
  { key: "milestones", label: "Milestones" },
  { key: "activity", label: "Activity" },
];

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

type Initiative = {
  id: string;
  name: string;
  status: string;
  color?: string;
  targetDate?: string;
  projects: Array<{ id: string; name?: string }>;
};

type Milestone = {
  id: string;
  name: string;
  targetDate?: string;
  projectName: string;
  projectColor?: string;
};

type CycleDetail = {
  id: string;
  name: string | null;
  number: number;
  startsAt: string | null;
  endsAt: string | null;
  isCurrent: boolean;
  isUpcoming: boolean;
  stats?: { total: number; completed: number };
  documents: Array<{ id: string; title: string; content?: string; slugId: string; icon?: string; color?: string; updatedAt: string }>;
  links: Array<{ id: string; label: string; url: string; createdAt: string }>;
};

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

export function TeamTabs({
  issues,
  states,
  labels,
  cycles,
  cycleDetails,
  projects,
  overviewOnlyProjectIds = [],
  initiatives,
  milestones,
  hubSlug,
  teamKey,
  teamId,
  hubId,
}: {
  issues: Issue[];
  states: Array<{ id: string; name: string; color: string; type: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  cycles?: Array<{ id: string; name: string; number: number }>;
  cycleDetails?: CycleDetail[];
  projects: Project[];
  overviewOnlyProjectIds?: string[];
  initiatives: Initiative[];
  milestones: Milestone[];
  hubSlug: string;
  teamKey: string;
  teamId: string;
  hubId: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const overviewOnlySet = useMemo(() => new Set(overviewOnlyProjectIds), [overviewOnlyProjectIds]);
  const visibleProjects = useMemo(
    () => projects.filter((p) => !overviewOnlySet.has(p.id)),
    [projects, overviewOnlySet]
  );

  const requestedTab = (searchParams.get("tab") as Tab) || "issues";
  const activeTab = requestedTab === "issues" && issues.length === 0 ? "projects" : requestedTab;

  function setTab(tab: Tab) {
    captureEvent(POSTHOG_EVENTS.tab_switched, { tab });
    const params = new URLSearchParams(searchParams.toString());
    if (tab === "issues") {
      params.delete("tab");
    } else {
      params.set("tab", tab);
      // Clear issue-specific params when leaving issues tab
      params.delete("q");
      params.delete("status");
      params.delete("priority");
      params.delete("label");
      params.delete("view");
      params.delete("project");
      params.delete("cycle");
      params.delete("groupBy");
      // Clear roadmap-specific params when leaving roadmap tab
      params.delete("roadmapView");
      params.delete("roadmapGroup");
      params.delete("rs");
      params.delete("rp");
      params.delete("rl");
    }
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-border px-6 shrink-0">
        {TABS.filter((tab) => {
          if (tab.key === "issues") return issues.length > 0;
          if (tab.key === "activity") return true;
          if (tab.key === "projects") return projects.length > 0;
          if (tab.key === "roadmap") return visibleProjects.length > 0;
          if (tab.key === "cycles") return (cycleDetails?.length ?? 0) > 0;
          if (tab.key === "initiatives") return initiatives.length > 0;
          if (tab.key === "milestones") return milestones.length > 0;
          return true;
        }).map((tab) => {
          const isActive = activeTab === tab.key;
          const count =
            tab.key === "issues"
              ? issues.length
              : tab.key === "projects"
                ? projects.length
                : tab.key === "roadmap"
                  ? visibleProjects.length
                  : tab.key === "cycles"
                    ? (cycleDetails?.length ?? 0)
                    : tab.key === "initiatives"
                      ? initiatives.length
                      : tab.key === "activity"
                        ? null
                        : milestones.length;

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
              {/* Active underline */}
              {isActive && (
                <span className="absolute bottom-0 left-3 right-3 h-[2px] bg-foreground rounded-t-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "issues" && (
        <ProjectIssueList
          issues={issues}
          states={states}
          labels={labels}
          cycles={cycles}
          projects={visibleProjects.map((p) => ({
            id: p.id,
            name: p.name,
            color: p.color,
          }))}
          hubSlug={hubSlug}
          teamKey={teamKey}
          teamId={teamId}
          hubId={hubId}
        />
      )}

      {activeTab === "projects" && (
        <div className="p-6 max-w-4xl overflow-y-auto">
          {projects.length === 0 ? (
            <EmptySection message="No epics visible for this project" />
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  href={`/hub/${hubSlug}/${teamKey}/projects/${project.id}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "roadmap" && (
        <RoadmapView projects={visibleProjects} />
      )}

      {activeTab === "cycles" && (
        <div className="p-6 max-w-4xl overflow-y-auto">
          {!cycleDetails || cycleDetails.length === 0 ? (
            <EmptySection message="This project doesn't use cycles" />
          ) : (
            <CyclesTabContent
              cycles={cycleDetails}
              hubSlug={hubSlug}
              teamKey={teamKey}
            />
          )}
        </div>
      )}

      {activeTab === "initiatives" && (
        <div className="p-6 max-w-4xl overflow-y-auto">
          {initiatives.length === 0 ? (
            <EmptySection message="No initiatives linked to this project" />
          ) : (
            <div className="space-y-2">
              {initiatives.map((init) => (
                <InitiativeCard key={init.id} initiative={init} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "milestones" && (
        <div className="p-6 max-w-4xl overflow-y-auto">
          {milestones.length === 0 ? (
            <EmptySection message="No milestones set on visible epics" />
          ) : (
            <div className="space-y-1.5">
              {milestones.map((m, i) => (
                <MilestoneRow key={`${m.id}-${i}`} milestone={m} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "activity" && (
        <>
          <div className="p-6 max-w-4xl overflow-y-auto">
            <ActivityFeed hubId={hubId} hubSlug={hubSlug} teamId={teamId} />
          </div>
          <ActivityIssueDetail hubId={hubId} />
        </>
      )}
    </div>
  );
}

// Mounted only while the Activity tab is active. Reads `?issue=` from the URL
// and renders the issue panel in place, so clicking an activity item keeps the
// Activity tab active instead of bouncing the user to the Tasks tab.
function ActivityIssueDetail({ hubId }: { hubId: string }) {
  const canInteract = useCanInteract();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleClose = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("issue");
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <IssueDetailPanel
      issueId={null}
      hubId={hubId}
      isViewOnly={!canInteract}
      onClose={handleClose}
    />
  );
}

// -- Sub-components ──────────────────────────────────────────────────────────

function EmptySection({ message }: { message: string }) {
  return (
    <div className="border border-border rounded-lg p-6 bg-card text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function ProjectCard({
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

function InitiativeCard({
  initiative,
}: {
  initiative: Initiative;
}) {
  return (
    <div className="border border-border rounded-lg px-4 py-3 bg-card">
      <div className="flex items-center gap-2 mb-1.5">
        <Target
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: initiative.color || "var(--muted-foreground)" }}
        />
        <p className="text-sm font-medium truncate">{initiative.name}</p>
        <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted shrink-0">
          {initiative.status}
        </span>
      </div>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>
          {initiative.projects.length}{" "}
          {initiative.projects.length === 1 ? "epic" : "epics"}
        </span>
        {initiative.targetDate && (
          <span className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            {formatDate(initiative.targetDate)}
          </span>
        )}
      </div>
    </div>
  );
}

function MilestoneRow({
  milestone,
}: {
  milestone: Milestone;
}) {
  const isPast =
    milestone.targetDate && new Date(milestone.targetDate) < new Date();

  return (
    <div className="flex items-center gap-3 px-4 py-2 border border-border rounded-md bg-card">
      <Flag
        className="w-3.5 h-3.5 shrink-0"
        style={{ color: milestone.projectColor || "var(--muted-foreground)" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{milestone.name}</p>
        <span className="text-[10px] text-muted-foreground">
          {milestone.projectName}
        </span>
      </div>
      {milestone.targetDate && (
        <span
          className={`text-[10px] tabular-nums shrink-0 ${
            isPast ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {formatDate(milestone.targetDate)}
        </span>
      )}
    </div>
  );
}

function CyclesTabContent({
  cycles,
  hubSlug,
  teamKey,
}: {
  cycles: CycleDetail[];
  hubSlug: string;
  teamKey: string;
}) {
  const currentCycles = cycles.filter((c) => c.isCurrent);
  const upcomingCycles = cycles.filter((c) => c.isUpcoming);
  const completedCycles = cycles.filter(
    (c) => !c.isCurrent && !c.isUpcoming
  );

  function renderSection(title: string, items: CycleDetail[]) {
    if (items.length === 0) return null;
    return (
      <div>
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {title}
        </h3>
        <div className="space-y-1.5">
          {items.map((cycle) => (
            <CycleCard
              key={cycle.id}
              cycle={cycle}
              href={`/hub/${hubSlug}/${teamKey}/cycles/${cycle.id}`}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {renderSection("Active", currentCycles)}
      {renderSection("Upcoming", upcomingCycles)}
      {renderSection("Completed", completedCycles)}
    </div>
  );
}

function CycleCard({
  cycle,
  href,
}: {
  cycle: CycleDetail;
  href: string;
}) {
  const total = cycle.stats?.total ?? 0;
  const completed = cycle.stats?.completed ?? 0;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const cycleName =
    cycle.name || `Cycle ${cycle.number}`;
  const dateRange =
    cycle.startsAt && cycle.endsAt
      ? `${formatDate(cycle.startsAt)} – ${formatDate(cycle.endsAt)}`
      : null;

  const hasPills = cycle.documents.length > 0 || cycle.links.length > 0;

  return (
    <div
      className={cn(
        "border rounded-lg bg-card transition-colors",
        cycle.isCurrent
          ? "border-l-2 border-l-primary/60 border-t-border border-r-border border-b-border bg-primary/[0.02]"
          : "border-border"
      )}
    >
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors rounded-lg group"
      >
        <IterationCw
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            cycle.isCurrent ? "text-primary/70" : "text-muted-foreground"
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium group-hover:text-primary transition-colors truncate">
              {cycleName}
            </p>
            {cycle.isCurrent && (
              <span className="text-[10px] font-medium text-primary/80 px-1.5 py-0.5 rounded bg-primary/10 shrink-0">
                Current
              </span>
            )}
            {cycle.isUpcoming && (
              <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded bg-muted shrink-0">
                Upcoming
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {dateRange && (
              <span className="text-[10px] text-muted-foreground">
                {dateRange}
              </span>
            )}
            {total > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {completed} / {total} tasks completed
              </span>
            )}
          </div>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progressPct}%`,
                  backgroundColor: cycle.isCurrent
                    ? "var(--primary)"
                    : "var(--muted-foreground)",
                }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground w-7 text-right">
              {progressPct}%
            </span>
          </div>
        )}
      </Link>
      {hasPills && (
        <div className="px-4 pb-3">
          <CycleCardPills documents={cycle.documents} links={cycle.links} />
        </div>
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}
