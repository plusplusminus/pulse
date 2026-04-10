"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ListOrdered, Calculator } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LinearIssue } from "@/lib/linear";
import { ProjectIssueList } from "./project-issue-list";
import { ProjectUpdates } from "./project-updates";
import { ProjectOverview } from "./project-overview";
import { TaskRankingView } from "./task-ranking-view";
import { TaskRiceScoringView } from "./task-rice-scoring-view";

export type ProjectLink = {
  id: string;
  label: string;
  url: string;
  createdAt: string;
};

export type ProjectDocument = {
  id: string;
  title: string;
  content?: string;
  slugId: string;
  icon?: string;
  color?: string;
  updatedAt: string;
};

type ProjectTabsProps = {
  project: {
    id: string;
    name: string;
    description?: string;
    content?: string;
    priority: number;
    priorityLabel: string;
    health?: string;
    lead?: { id: string; name: string };
    milestones: Array<{ id: string; name: string; targetDate?: string }>;
    status: { id: string; name: string; color: string; type: string };
  };
  links: ProjectLink[];
  documents: ProjectDocument[];
  isOverviewOnly: boolean;
  taskPriorityEnabled?: boolean;
  issues: LinearIssue[];
  states: Array<{ id: string; name: string; color: string; type: string }>;
  labels: Array<{ id: string; name: string; color: string }>;
  cycles: Array<{ id: string; name: string; number: number }>;
  hubSlug: string;
  teamKey: string;
  teamId: string;
  projectId: string;
  hubId: string;
};

type Tab = "overview" | "issues" | "priority";

export function ProjectTabs({
  project,
  links,
  documents,
  isOverviewOnly,
  taskPriorityEnabled,
  issues,
  states,
  labels,
  cycles,
  hubSlug,
  teamKey,
  teamId,
  projectId,
  hubId,
}: ProjectTabsProps) {
  const searchParams = useSearchParams();
  const [priorityMode, setPriorityMode] = useState<"rank" | "rice">(
    (searchParams.get("priorityMode") as "rank" | "rice") || "rank"
  );
  // Exclude started (In Progress/In Review), completed, and cancelled tasks from priority views
  const priorityTasks = useMemo(
    () =>
      issues
        .filter((issue) => !["started", "completed", "cancelled"].includes(issue.state.type))
        .map((issue) => ({
          id: issue.id,
          title: issue.title,
          identifier: issue.identifier,
          status: issue.state,
          labels: issue.labels,
        })),
    [issues]
  );

  const hasOverviewContent =
    isOverviewOnly ||
    !!project.content ||
    !!project.description ||
    project.priority > 0 ||
    !!project.health ||
    !!project.lead ||
    project.milestones.length > 0 ||
    links.length > 0 ||
    documents.length > 0;

  const [activeTab, setActiveTab] = useState<Tab>(
    isOverviewOnly || issues.length === 0 ? "overview" : "issues"
  );

  const tabs: { id: Tab; label: string; count?: number }[] = isOverviewOnly
    ? [{ id: "overview", label: "Overview" }]
    : [
        ...(hasOverviewContent
          ? [{ id: "overview" as const, label: "Overview" }]
          : []),
        ...(issues.length > 0
          ? [{ id: "issues" as const, label: "Tasks", count: issues.length }]
          : []),
        ...(taskPriorityEnabled && issues.length > 0
          ? [{ id: "priority" as const, label: "Priority" }]
          : []),
      ];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab bar — hide when only one tab */}
      {tabs.length > 1 && (
      <div className="flex items-center gap-0 px-6 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors",
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>
      )}

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="flex-1 overflow-auto">
          <ProjectOverview project={project} links={links} documents={documents} />
          <ProjectUpdates hubId={hubId} projectId={projectId} />
        </div>
      )}

      {activeTab === "issues" && !isOverviewOnly && (
        <ProjectIssueList
          issues={issues}
          states={states}
          labels={labels}
          cycles={cycles}
          hubSlug={hubSlug}
          teamKey={teamKey}
          teamId={teamId}
          projectId={projectId}
          hubId={hubId}
        />
      )}

      {activeTab === "priority" && taskPriorityEnabled && (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Mode toggle — matches epic-level priority toggle */}
          <div className="flex justify-end px-6 pt-4">
            <div className="flex items-center border border-border rounded-md overflow-hidden">
              <button
                onClick={() => setPriorityMode("rank")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-xs transition-colors",
                  priorityMode === "rank"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="Drag & drop ranking"
              >
                <ListOrdered className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Rank</span>
              </button>
              <button
                onClick={() => setPriorityMode("rice")}
                className={cn(
                  "flex items-center gap-1 px-2 py-1 text-xs transition-colors",
                  priorityMode === "rice"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                title="RICE scoring"
              >
                <Calculator className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">RICE</span>
              </button>
            </div>
          </div>

          {priorityMode === "rank" ? (
            <TaskRankingView projectId={projectId} tasks={priorityTasks} />
          ) : (
            <TaskRiceScoringView projectId={projectId} tasks={priorityTasks} />
          )}
        </div>
      )}
    </div>
  );
}
