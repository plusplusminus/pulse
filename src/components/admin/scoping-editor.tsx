"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TeamPicker, ProjectPicker, LabelPicker, InitiativePicker } from "./pickers";
import { Plus, Trash2, ChevronDown, ChevronRight, Eye, BarChart3 } from "lucide-react";
import { WorkflowRules } from "./workflow-rules";

interface TeamMapping {
  id: string;
  linear_team_id: string;
  linear_team_name: string | null;
  visible_project_ids: string[];
  visible_initiative_ids: string[];
  visible_label_ids: string[];
  hidden_label_ids: string[];
  auto_include_projects: boolean;
  include_unassigned_issues: boolean;
  overview_only_project_ids: string[];
  task_priority_project_ids: string[];
  is_active: boolean;
}

type ScopingUpdates = Partial<Pick<TeamMapping,
  "visible_project_ids" | "visible_initiative_ids" | "visible_label_ids" |
  "hidden_label_ids" | "auto_include_projects" | "include_unassigned_issues" |
  "overview_only_project_ids" | "task_priority_project_ids"
>>;

interface ScopingEditorProps {
  hubId: string;
  mappings: TeamMapping[];
}

export function ScopingEditor({ hubId, mappings }: ScopingEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expandedTeam, setExpandedTeam] = useState<string | null>(
    mappings[0]?.id ?? null
  );
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [addingTeamIds, setAddingTeamIds] = useState<string[]>([]);

  function saveMapping(mapping: TeamMapping, updates: ScopingUpdates) {
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/hubs/${hubId}/teams/${mapping.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
          }
        );
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to save");
        }
        toast.success(`${mapping.linear_team_name ?? "Team"} scoping saved`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }

  function removeMapping(mapping: TeamMapping) {
    if (!confirm(`Remove ${mapping.linear_team_name ?? "this team"} from the hub?`)) return;

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/hubs/${hubId}/teams/${mapping.id}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to remove");
        }
        toast.success(`${mapping.linear_team_name ?? "Team"} removed`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to remove");
      }
    });
  }

  function addTeams() {
    startTransition(async () => {
      let added = 0;
      for (const teamId of addingTeamIds) {
        try {
          const res = await fetch(`/api/admin/hubs/${hubId}/teams`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ linear_team_id: teamId }),
          });
          if (res.ok) added++;
        } catch {
          // continue adding others
        }
      }
      if (added > 0) {
        toast.success(`Added ${added} team${added !== 1 ? "s" : ""}`);
        setAddingTeamIds([]);
        setShowAddTeam(false);
        router.refresh();
      } else {
        toast.error("Failed to add teams");
      }
    });
  }

  return (
    <div className="space-y-4">
      {mappings.length === 0 && !showAddTeam && (
        <div className="border border-border rounded-lg p-6 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            No teams mapped to this hub yet.
          </p>
          <button
            onClick={() => setShowAddTeam(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Team
          </button>
        </div>
      )}

      {/* Existing mappings */}
      {mappings.map((mapping) => {
        const isExpanded = expandedTeam === mapping.id;
        return (
          <MappingCard
            key={mapping.id}
            hubId={hubId}
            mapping={mapping}
            expanded={isExpanded}
            onToggle={() =>
              setExpandedTeam(isExpanded ? null : mapping.id)
            }
            onSave={(updates) => saveMapping(mapping, updates)}
            onRemove={() => removeMapping(mapping)}
            isPending={isPending}
          />
        );
      })}

      {/* Add team section */}
      {mappings.length > 0 && !showAddTeam && (
        <button
          onClick={() => setShowAddTeam(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add team
        </button>
      )}

      {showAddTeam && (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium">Add teams</p>
          <TeamPicker value={addingTeamIds} onChange={setAddingTeamIds} />
          <div className="flex items-center gap-2">
            <button
              onClick={addTeams}
              disabled={addingTeamIds.length === 0 || isPending}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                addingTeamIds.length > 0
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {isPending ? "Adding..." : `Add ${addingTeamIds.length || ""} team${addingTeamIds.length !== 1 ? "s" : ""}`}
            </button>
            <button
              onClick={() => {
                setShowAddTeam(false);
                setAddingTeamIds([]);
              }}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MappingCard({
  hubId,
  mapping,
  expanded,
  onToggle,
  onSave,
  onRemove,
  isPending,
}: {
  hubId: string;
  mapping: TeamMapping;
  expanded: boolean;
  onToggle: () => void;
  onSave: (updates: ScopingUpdates) => void;
  onRemove: () => void;
  isPending: boolean;
}) {
  const [autoInclude, setAutoInclude] = useState(mapping.auto_include_projects);
  const [includeUnassigned, setIncludeUnassigned] = useState(mapping.include_unassigned_issues);
  const [projectIds, setProjectIds] = useState(mapping.visible_project_ids);
  const [overviewOnlyIds, setOverviewOnlyIds] = useState(mapping.overview_only_project_ids);
  const [taskPriorityIds, setTaskPriorityIds] = useState(mapping.task_priority_project_ids);
  const [initiativeIds, setInitiativeIds] = useState(mapping.visible_initiative_ids);
  const [labelIds, setLabelIds] = useState(mapping.visible_label_ids);
  const [hiddenLabelIds, setHiddenLabelIds] = useState(mapping.hidden_label_ids);

  const hasChanges =
    autoInclude !== mapping.auto_include_projects ||
    includeUnassigned !== mapping.include_unassigned_issues ||
    JSON.stringify(projectIds) !== JSON.stringify(mapping.visible_project_ids) ||
    JSON.stringify(overviewOnlyIds) !== JSON.stringify(mapping.overview_only_project_ids) ||
    JSON.stringify(taskPriorityIds) !== JSON.stringify(mapping.task_priority_project_ids) ||
    JSON.stringify(initiativeIds) !== JSON.stringify(mapping.visible_initiative_ids) ||
    JSON.stringify(labelIds) !== JSON.stringify(mapping.visible_label_ids) ||
    JSON.stringify(hiddenLabelIds) !== JSON.stringify(mapping.hidden_label_ids);

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
          {mapping.linear_team_name ?? mapping.linear_team_id}
        </button>
        <div className="flex items-center gap-2">
          <ScopingBadges mapping={mapping} autoInclude={autoInclude} includeUnassigned={includeUnassigned} overviewOnlyCount={overviewOnlyIds.length} taskPriorityCount={taskPriorityIds.length} />
          <button
            onClick={onRemove}
            disabled={isPending}
            className="p-1 text-muted-foreground hover:text-destructive transition-colors"
            title="Remove team"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4">
          {/* Auto-include toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Show all projects</p>
              <p className="text-xs text-muted-foreground">
                Automatically include all projects, including newly created ones.
              </p>
            </div>
            <button
              onClick={() => {
                const next = !autoInclude;
                setAutoInclude(next);
                if (next) setProjectIds([]);
              }}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                autoInclude ? "bg-primary" : "bg-muted"
              )}
              role="switch"
              aria-checked={autoInclude}
              aria-label="Automatically include all projects"
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
                  autoInclude ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>

          {/* Project picker — hidden when auto-include is on */}
          {!autoInclude && (
            <ProjectPicker
              teamId={mapping.linear_team_id}
              value={projectIds}
              onChange={setProjectIds}
            />
          )}

          {/* Include unassigned issues toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Include unassigned tasks</p>
              <p className="text-xs text-muted-foreground">
                Show tasks that aren&apos;t assigned to any project (e.g. cycle-only tasks).
              </p>
            </div>
            <button
              onClick={() => setIncludeUnassigned(!includeUnassigned)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                includeUnassigned ? "bg-primary" : "bg-muted"
              )}
              role="switch"
              aria-checked={includeUnassigned}
              aria-label="Include unassigned tasks"
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
                  includeUnassigned ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>

          {/* Overview-only projects */}
          <div>
            <ProjectPicker
              teamId={mapping.linear_team_id}
              value={overviewOnlyIds}
              onChange={(ids) => {
                setOverviewOnlyIds(ids);
                // Remove any newly overview-only projects from task priority
                setTaskPriorityIds((prev) =>
                  prev.filter((id) => !ids.includes(id))
                );
              }}
              label="Overview-only projects"
              description="These projects will show their description and updates but not individual issues."
              icon={<Eye className="w-3.5 h-3.5 text-muted-foreground" />}
            />
          </div>

          {/* Task prioritisation opt-in */}
          <div>
            <ProjectPicker
              teamId={mapping.linear_team_id}
              value={taskPriorityIds}
              onChange={setTaskPriorityIds}
              label="Task prioritisation"
              description="Clients can rank and RICE-score individual tasks within these projects. Only non-overview-only projects can be selected."
              icon={<BarChart3 className="w-3.5 h-3.5 text-muted-foreground" />}
              excludeIds={overviewOnlyIds}
            />
          </div>

          <LabelPicker
            teamId={mapping.linear_team_id}
            value={labelIds}
            onChange={setLabelIds}
            label="Visible labels"
            description="Only these labels will be shown on issues in the client hub. Leave empty to show all."
          />
          <LabelPicker
            teamId={mapping.linear_team_id}
            value={hiddenLabelIds}
            onChange={setHiddenLabelIds}
            label="Hidden tasks"
            description="Issues with any of these labels will be entirely excluded from the client hub."
          />
          <InitiativePicker
            value={initiativeIds}
            onChange={setInitiativeIds}
          />

          {/* Workflow Rules */}
          <div className="border-t border-border pt-4 mt-4">
            <WorkflowRules
              hubId={hubId}
              mappingId={mapping.id}
              teamId={mapping.linear_team_id}
              visibleLabelIds={labelIds}
            />
          </div>

          {hasChanges && (
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() =>
                  onSave({
                    auto_include_projects: autoInclude,
                    include_unassigned_issues: includeUnassigned,
                    visible_project_ids: autoInclude ? [] : projectIds,
                    overview_only_project_ids: overviewOnlyIds,
                    task_priority_project_ids: taskPriorityIds,
                    visible_initiative_ids: initiativeIds,
                    visible_label_ids: labelIds,
                    hidden_label_ids: hiddenLabelIds,
                  })
                }
                disabled={isPending}
                className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isPending ? "Saving..." : "Save Scoping"}
              </button>
              <button
                onClick={() => {
                  setAutoInclude(mapping.auto_include_projects);
                  setIncludeUnassigned(mapping.include_unassigned_issues);
                  setProjectIds(mapping.visible_project_ids);
                  setOverviewOnlyIds(mapping.overview_only_project_ids);
                  setTaskPriorityIds(mapping.task_priority_project_ids);
                  setInitiativeIds(mapping.visible_initiative_ids);
                  setLabelIds(mapping.visible_label_ids);
                  setHiddenLabelIds(mapping.hidden_label_ids);
                }}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScopingBadges({
  mapping,
  autoInclude,
  includeUnassigned,
  overviewOnlyCount,
  taskPriorityCount,
}: {
  mapping: TeamMapping;
  autoInclude: boolean;
  includeUnassigned: boolean;
  overviewOnlyCount: number;
  taskPriorityCount: number;
}) {
  const p = mapping.visible_project_ids.length;
  const l = mapping.visible_label_ids.length;
  const h = mapping.hidden_label_ids.length;
  const i = mapping.visible_initiative_ids.length;

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
        {autoInclude ? "Auto" : p === 0 ? "None" : p} proj
      </span>
      {includeUnassigned && (
        <span className="text-[10px] text-amber-500/80 px-1.5 py-0.5 rounded bg-amber-500/10">
          +unassigned
        </span>
      )}
      {overviewOnlyCount > 0 && (
        <span className="text-[10px] text-blue-500/80 px-1.5 py-0.5 rounded bg-blue-500/10">
          {overviewOnlyCount} overview
        </span>
      )}
      {taskPriorityCount > 0 && (
        <span className="text-[10px] text-violet-500/80 px-1.5 py-0.5 rounded bg-violet-500/10">
          {taskPriorityCount} task prio
        </span>
      )}
      <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
        {l === 0 ? "All" : l} labels
      </span>
      {h > 0 && (
        <span className="text-[10px] text-destructive/80 px-1.5 py-0.5 rounded bg-destructive/10">
          {h} hidden
        </span>
      )}
      <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
        {i === 0 ? "All" : i} init
      </span>
    </div>
  );
}
