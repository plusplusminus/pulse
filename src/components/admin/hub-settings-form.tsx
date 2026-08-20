"use client";

import { useState, useTransition, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";
import { useFetch } from "@/hooks/use-fetch";
import { ScopingEditor } from "./scoping-editor";
import { LabelPicker } from "./pickers/label-picker";
import { AlertTriangle, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import type { FormTemplate, HubFormConfig } from "@/lib/supabase";

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

interface HubSettingsFormProps {
  hub: {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
  };
  mappings: TeamMapping[];
}

type Tab = "general" | "scoping" | "forms" | "danger";

export function HubSettingsForm({ hub, mappings }: HubSettingsFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const initialTab = (searchParams.get("tab") as Tab) || "general";
  const [tab, setTab] = useState<Tab>(initialTab);

  // General state
  const [name, setName] = useState(hub.name);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDirty(name.trim() !== hub.name);
  }, [name, hub.name]);

  // Warn on navigation with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const saveGeneral = useCallback(() => {
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/hubs/${hub.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
          }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to save");
        }
        toast.success("Hub settings saved");
        captureEvent(POSTHOG_EVENTS.hub_settings_updated, { hubId: hub.id });
        setDirty(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }, [hub.id, name, router]);

  const deactivateHub = useCallback(() => {
    if (!confirm(`Are you sure you want to ${hub.is_active ? "deactivate" : "reactivate"} "${hub.name}"?`)) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/admin/hubs/${hub.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: !hub.is_active }),
        });
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to update");
        }
        toast.success(hub.is_active ? "Hub deactivated" : "Hub reactivated");
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to update");
      }
    });
  }, [hub.id, hub.name, hub.is_active, router]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "general", label: "General" },
    { key: "scoping", label: "Teams & Scoping" },
    { key: "forms", label: "Forms" },
    { key: "danger", label: "Danger Zone" },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold mb-1">{hub.name}</h1>
      <p className="text-sm text-muted-foreground mb-6">
        /{hub.slug}
      </p>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-border mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-3 py-1.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* General tab */}
      {tab === "general" && (
        <div className="space-y-6">
          <div>
            <label htmlFor="hub-name" className="block text-sm font-medium mb-1.5">
              Hub Name
            </label>
            <input
              id="hub-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={saveGeneral}
              disabled={!dirty || !name.trim() || isPending}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                dirty && name.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {isPending ? "Saving..." : "Save Changes"}
            </button>
            {dirty && (
              <span className="text-xs text-muted-foreground">Unsaved changes</span>
            )}
          </div>
        </div>
      )}

      {/* Scoping tab */}
      {tab === "scoping" && (
        <ScopingEditor hubId={hub.id} mappings={mappings} />
      )}

      {/* Forms tab */}
      {tab === "forms" && (
        <HubFormsTab hubId={hub.id} teamMappings={mappings} />
      )}

      {/* Danger zone tab */}
      {tab === "danger" && (
        <div className="border border-destructive/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium">
                {hub.is_active ? "Deactivate Hub" : "Reactivate Hub"}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                {hub.is_active
                  ? "Deactivating will hide this hub from all client users. No data is deleted."
                  : "Reactivating will make this hub visible to client users again."}
              </p>
              <button
                onClick={deactivateHub}
                disabled={isPending}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                  hub.is_active
                    ? "bg-destructive text-white hover:bg-destructive/90"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
              >
                {isPending
                  ? "Updating..."
                  : hub.is_active
                    ? "Deactivate Hub"
                    : "Reactivate Hub"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Hub Forms Tab
// ============================================================

const TYPE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  bug: { bg: "var(--badge-orange-bg)", text: "var(--badge-orange-text)", label: "Bug" },
  feature: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)", label: "Feature" },
  custom: { bg: "var(--badge-gray-bg)", text: "var(--badge-gray-text)", label: "Custom" },
};

const inputClass =
  "w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent";

type HubFormsApiResponse = {
  global_forms: Array<FormTemplate & { hub_config: HubFormConfig | null }>;
  hub_forms: FormTemplate[];
};

function HubFormsTab({ hubId, teamMappings }: { hubId: string; teamMappings: TeamMapping[] }) {
  const [isPending, startTransition] = useTransition();
  const { data: hubFormsData, loading: configsLoading, refetch: refetchConfigs } =
    useFetch<HubFormsApiResponse>(`/api/admin/hubs/${hubId}/forms`);
  const [expandedForm, setExpandedForm] = useState<string | null>(null);

  // Override state per form
  const [overrides, setOverrides] = useState<
    Record<string, Partial<HubFormConfig>>
  >({});

  // Seed overrides from fetched hub form configs
  useEffect(() => {
    if (hubFormsData?.global_forms) {
      const map: Record<string, Partial<HubFormConfig>> = {};
      for (const gf of hubFormsData.global_forms) {
        if (gf.hub_config) {
          map[gf.id] = {
            is_enabled: gf.hub_config.is_enabled,
            target_label_ids: gf.hub_config.target_label_ids,
            confirmation_message: gf.hub_config.confirmation_message,
          };
        }
      }
      setOverrides(map);
    }
  }, [hubFormsData]);

  const getOverride = (formId: string) =>
    overrides[formId] ?? {};

  const isEnabled = (formId: string) =>
    getOverride(formId).is_enabled ?? false;

  const toggleEnabled = (formId: string) => {
    const current = isEnabled(formId);
    const newEnabled = !current;

    setOverrides((prev) => ({
      ...prev,
      [formId]: { ...prev[formId], is_enabled: newEnabled },
    }));

    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/hubs/${hubId}/forms/${formId}/config`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_enabled: newEnabled }),
          }
        );
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to update");
        }
        toast.success(
          newEnabled ? "Form enabled for hub" : "Form disabled for hub"
        );
        refetchConfigs();
      } catch (e) {
        setOverrides((prev) => ({
          ...prev,
          [formId]: { ...prev[formId], is_enabled: current },
        }));
        toast.error(e instanceof Error ? e.message : "Failed to update");
      }
    });
  };

  const saveOverrides = (formId: string) => {
    const ovr = getOverride(formId);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/admin/hubs/${hubId}/forms/${formId}/config`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              target_label_ids: ovr.target_label_ids ?? null,
              confirmation_message: ovr.confirmation_message || null,
            }),
          }
        );
        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to save overrides");
        }
        toast.success("Overrides saved");
        refetchConfigs();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save");
      }
    });
  };

  const updateOverride = (
    formId: string,
    patch: Partial<HubFormConfig>
  ) => {
    setOverrides((prev) => ({
      ...prev,
      [formId]: { ...prev[formId], ...patch },
    }));
  };

  const globalForms = hubFormsData?.global_forms ?? [];

  return (
    <div className="space-y-6">
      {configsLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading forms...
        </div>
      ) : (
        <>
          {/* Global Forms */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Global Forms</h3>
            {globalForms.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6 border border-border rounded-lg bg-card">
                No global forms created yet.{" "}
                <Link
                  href="/admin/forms/new"
                  className="text-primary hover:underline"
                >
                  Create one
                </Link>
              </div>
            ) : (
              <div className="border border-border rounded-lg bg-card overflow-hidden">
                {globalForms.map((form, i) => {
                  const badge = TYPE_BADGE[form.type] ?? TYPE_BADGE.custom;
                  const enabled = isEnabled(form.id);
                  const isExpanded = expandedForm === form.id;
                  const ovr = getOverride(form.id);

                  return (
                    <div
                      key={form.id}
                      className={cn(
                        i < globalForms.length - 1 && "border-b border-border"
                      )}
                    >
                      <div className="flex items-center gap-3 px-4 py-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={enabled}
                          onClick={() => toggleEnabled(form.id)}
                          className={cn(
                            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                            enabled ? "bg-primary" : "bg-muted"
                          )}
                        >
                          <span
                            className={cn(
                              "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
                              enabled ? "translate-x-4" : "translate-x-0"
                            )}
                          />
                        </button>
                        <span className="text-sm font-medium flex-1 truncate">
                          {form.name}
                        </span>
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium"
                          style={{ backgroundColor: badge.bg, color: badge.text }}
                        >
                          {badge.label}
                        </span>
                        <button
                          onClick={() =>
                            setExpandedForm(isExpanded ? null : form.id)
                          }
                          className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                          title="Routing overrides"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="px-4 pb-4 space-y-3 border-t border-border/50 bg-muted/20">
                          <p className="text-xs text-muted-foreground pt-3">
                            Customize this form for the hub. Issues are routed to the hub&apos;s team automatically.
                          </p>

                          <LabelPicker
                            teamId={teamMappings[0]?.linear_team_id ?? null}
                            value={ovr.target_label_ids ?? []}
                            onChange={(ids) =>
                              updateOverride(form.id, { target_label_ids: ids })
                            }
                            label="Auto-apply Labels"
                            description="Labels automatically added to issues created from this form"
                          />

                          <div>
                            <label className="block text-xs font-medium mb-1">
                              Confirmation Message Override
                            </label>
                            <textarea
                              value={ovr.confirmation_message ?? ""}
                              onChange={(e) =>
                                updateOverride(form.id, {
                                  confirmation_message: e.target.value || null,
                                })
                              }
                              placeholder="Leave blank for form default"
                              rows={2}
                              className={inputClass}
                            />
                          </div>

                          <button
                            onClick={() => saveOverrides(form.id)}
                            disabled={isPending}
                            className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                          >
                            {isPending ? "Saving..." : "Save Overrides"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Hub-specific form creation removed — use global forms with per-hub opt-in */}
        </>
      )}
    </div>
  );
}
