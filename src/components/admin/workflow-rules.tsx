"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";
import { Plus, Trash2, Pencil, X, Loader2, Zap, ArrowRight } from "lucide-react";
import type { WorkflowTriggerType, WorkflowActionType } from "@/lib/supabase";

interface LinearLabel {
  id: string;
  name: string;
  color: string;
  parent?: { id: string; name: string } | null;
}

interface LinearState {
  id: string;
  name: string;
  color: string;
  type: string;
}

interface WorkflowRule {
  id: string;
  mapping_id: string;
  trigger_type: WorkflowTriggerType;
  trigger_label_id: string;
  trigger_from_label_id: string | null;
  condition_state_ids: string[] | null;
  action_type: WorkflowActionType;
  action_config: Record<string, unknown>;
  created_at: string;
}

interface WorkflowRulesProps {
  hubId: string;
  mappingId: string;
  teamId: string;
  visibleLabelIds: string[];
}

const TRIGGER_LABELS: Record<WorkflowTriggerType, string> = {
  label_added: "When label is added",
  label_removed: "When label is removed",
  label_changed: "When label changes",
};

export function WorkflowRules({ hubId, mappingId, teamId, visibleLabelIds }: WorkflowRulesProps) {
  const [rules, setRules] = useState<WorkflowRule[]>([]);
  const [labels, setLabels] = useState<LinearLabel[]>([]);
  const [states, setStates] = useState<LinearState[]>([]);
  const [loading, setLoading] = useState(true);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<WorkflowRule | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>("label_added");
  const [triggerLabelId, setTriggerLabelId] = useState("");
  const [triggerFromLabelId, setTriggerFromLabelId] = useState("");
  const [actionType] = useState<WorkflowActionType>("set_status");
  const [conditionStateIds, setConditionStateIds] = useState<string[]>([]);
  const [targetStateId, setTargetStateId] = useState("");

  const fetchRules = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/hubs/${hubId}/workflow-rules`);
      if (!res.ok) return;
      const data = (await res.json()) as { rules: WorkflowRule[] };
      setRules(data.rules.filter((r) => r.mapping_id === mappingId));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [hubId, mappingId]);

  const fetchOptions = useCallback(async () => {
    if (optionsLoaded) return;
    try {
      const res = await fetch(
        `/api/admin/hubs/${hubId}/linear-options?teamId=${teamId}`
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        labels: LinearLabel[];
        states: LinearState[];
      };
      // Only show labels that are visible in this team mapping
      const filteredLabels =
        visibleLabelIds.length > 0
          ? data.labels.filter((l: LinearLabel) => visibleLabelIds.includes(l.id))
          : data.labels;
      setLabels(filteredLabels);
      setStates(data.states);
      setOptionsLoaded(true);
    } catch {
      // ignore
    }
  }, [hubId, teamId, optionsLoaded, visibleLabelIds]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  // Eagerly load label/state names so rule rows can display them
  useEffect(() => {
    if (!loading && rules.length > 0 && !optionsLoaded) {
      fetchOptions();
    }
  }, [loading, rules.length, optionsLoaded, fetchOptions]);

  function resetForm() {
    setTriggerType("label_added");
    setTriggerLabelId("");
    setTriggerFromLabelId("");
    setConditionStateIds([]);
    setTargetStateId("");
    setEditingRule(null);
    setShowForm(false);
  }

  function openAddForm() {
    resetForm();
    setShowForm(true);
    fetchOptions();
  }

  function openEditForm(rule: WorkflowRule) {
    setEditingRule(rule);
    setTriggerType(rule.trigger_type);
    setTriggerLabelId(rule.trigger_label_id);
    setTriggerFromLabelId(rule.trigger_from_label_id ?? "");
    setConditionStateIds(rule.condition_state_ids ?? []);
    setTargetStateId((rule.action_config.stateId as string) ?? "");
    setShowForm(true);
    fetchOptions();
  }

  async function saveRule() {
    if (!triggerLabelId || !targetStateId) {
      toast.error("Please fill in all required fields");
      return;
    }

    if (triggerType === "label_changed" && !triggerFromLabelId) {
      toast.error("Please select the 'from' label");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        ...(editingRule ? { id: editingRule.id } : { mapping_id: mappingId }),
        trigger_type: triggerType,
        trigger_label_id: triggerLabelId,
        trigger_from_label_id:
          triggerType === "label_changed" ? triggerFromLabelId : null,
        condition_state_ids: conditionStateIds.length > 0 ? conditionStateIds : null,
        action_type: actionType,
        action_config: { stateId: targetStateId },
      };

      const res = await fetch(`/api/admin/hubs/${hubId}/workflow-rules`, {
        method: editingRule ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to save rule");
      }

      toast.success(editingRule ? "Rule updated" : "Rule created");
      captureEvent(POSTHOG_EVENTS.workflow_rule_changed, {
        hubId,
        action: editingRule ? "update" : "create",
        triggerType,
      });
      resetForm();
      fetchRules();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRule(ruleId: string) {
    if (!confirm("Delete this workflow rule?")) return;

    try {
      const res = await fetch(
        `/api/admin/hubs/${hubId}/workflow-rules?id=${ruleId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to delete rule");
      }
      toast.success("Rule deleted");
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete rule");
    }
  }

  function getLabelName(labelId: string): string {
    const label = labels.find((l) => l.id === labelId);
    if (!label) return labelId.slice(0, 8) + "...";
    return label.parent ? `${label.parent.name} / ${label.name}` : label.name;
  }

  function getStateName(stateId: string): string {
    const state = states.find((s) => s.id === stateId);
    return state?.name ?? stateId.slice(0, 8) + "...";
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading rules...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-sm font-medium">Workflow Rules</span>
          {rules.length > 0 && (
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
              {rules.length}
            </span>
          )}
        </div>
        {!showForm && (
          <button
            onClick={openAddForm}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add rule
          </button>
        )}
      </div>

      {/* Existing rules */}
      {rules.length > 0 && (
        <div className="space-y-1.5">
          {rules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              getLabelName={getLabelName}
              getStateName={getStateName}
              optionsLoaded={optionsLoaded}
              onEdit={() => openEditForm(rule)}
              onDelete={() => deleteRule(rule.id)}
            />
          ))}
        </div>
      )}

      {rules.length === 0 && !showForm && (
        <p className="text-xs text-muted-foreground">
          No workflow rules configured. Rules automate status changes when labels are modified.
        </p>
      )}

      {/* Add/Edit form */}
      {showForm && (
        <div className="border border-border rounded-md p-3 space-y-3 bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">
              {editingRule ? "Edit Rule" : "New Rule"}
            </span>
            <button
              onClick={resetForm}
              className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Trigger type */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Trigger
            </label>
            <select
              value={triggerType}
              onChange={(e) => {
                setTriggerType(e.target.value as WorkflowTriggerType);
                if (e.target.value !== "label_changed") {
                  setTriggerFromLabelId("");
                }
              }}
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {Object.entries(TRIGGER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* From label (only for label_changed) */}
          {triggerType === "label_changed" && (
            <div>
              <label className="block text-xs text-muted-foreground mb-1">
                From label
              </label>
              <select
                value={triggerFromLabelId}
                onChange={(e) => setTriggerFromLabelId(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Select label...</option>
                {labels.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.parent ? `${l.parent.name} / ${l.name}` : l.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Trigger label */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              {triggerType === "label_changed" ? "To label" : "Label"}
            </label>
            <select
              value={triggerLabelId}
              onChange={(e) => setTriggerLabelId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select label...</option>
              {labels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.parent ? `${l.parent.name} / ${l.name}` : l.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status condition (optional) */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Only when issue is in status
              <span className="text-muted-foreground/60 ml-1">(optional)</span>
            </label>
            <div className="flex flex-wrap gap-1.5 p-2 border border-border rounded-md bg-background min-h-[36px]">
              {conditionStateIds.length === 0 && (
                <span className="text-xs text-muted-foreground/50 py-0.5">
                  Any status
                </span>
              )}
              {conditionStateIds.map((stateId) => {
                const state = states.find((s) => s.id === stateId);
                return (
                  <span
                    key={stateId}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-accent text-accent-foreground"
                  >
                    {state?.name ?? stateId.slice(0, 8) + "..."}
                    <button
                      type="button"
                      onClick={() =>
                        setConditionStateIds((prev) =>
                          prev.filter((id) => id !== stateId)
                        )
                      }
                      className="hover:text-destructive transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                );
              })}
            </div>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value && !conditionStateIds.includes(e.target.value)) {
                  setConditionStateIds((prev) => [...prev, e.target.value]);
                }
              }}
              className="w-full mt-1 px-2.5 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Add status condition...</option>
              {states
                .filter((s) => !conditionStateIds.includes(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Action: target state */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Set status to
            </label>
            <select
              value={targetStateId}
              onChange={(e) => setTargetStateId(e.target.value)}
              className="w-full px-2.5 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select status...</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={saveRule}
              disabled={saving || !triggerLabelId || !targetStateId}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                triggerLabelId && targetStateId
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {saving
                ? "Saving..."
                : editingRule
                  ? "Update Rule"
                  : "Add Rule"}
            </button>
            <button
              onClick={resetForm}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  getLabelName,
  getStateName,
  optionsLoaded,
  onEdit,
  onDelete,
}: {
  rule: WorkflowRule;
  getLabelName: (id: string) => string;
  getStateName: (id: string) => string;
  optionsLoaded: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  function triggerDescription(): string {
    const label = optionsLoaded
      ? getLabelName(rule.trigger_label_id)
      : "...";

    let base: string;
    switch (rule.trigger_type) {
      case "label_added":
        base = `"${label}" added`;
        break;
      case "label_removed":
        base = `"${label}" removed`;
        break;
      case "label_changed": {
        const from = rule.trigger_from_label_id && optionsLoaded
          ? getLabelName(rule.trigger_from_label_id)
          : "...";
        base = `"${from}" → "${label}"`;
        break;
      }
    }

    // Append status condition if present
    if (rule.condition_state_ids && rule.condition_state_ids.length > 0 && optionsLoaded) {
      const stateNames = rule.condition_state_ids
        .map((id) => getStateName(id))
        .join(", ");
      base += ` (in ${stateNames})`;
    }

    return base;
  }

  function actionDescription(): string {
    const stateId = rule.action_config.stateId as string | undefined;
    if (!stateId) return "Set status";
    const name = optionsLoaded ? getStateName(stateId) : "...";
    return `Set status to "${name}"`;
  }

  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md border border-border bg-background group">
      <div className="flex items-center gap-2 text-xs min-w-0">
        <span className="text-muted-foreground shrink-0">
          {triggerDescription()}
        </span>
        <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="truncate">{actionDescription()}</span>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
        <button
          onClick={onEdit}
          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          title="Edit"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={onDelete}
          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
