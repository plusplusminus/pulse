"use client";

import { useState, useTransition, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";
import { useFetch } from "@/hooks/use-fetch";
import {
  ChevronDown,
  X,
  Plus,
  GripVertical,
  Bug,
  Lightbulb,
  FileText,
  Calendar,
  MessageSquare,
  HelpCircle,
  Wrench,
  Flag,
  Star,
  Zap,
  Shield,
  Users,
  Mail,
  Phone,
  Megaphone,
  Check,
  Search,
  type LucideIcon,
} from "lucide-react";
import type {
  FormTemplate,
  FormField,
  FormFieldType,
  LinearFieldMapping,
} from "@/lib/supabase";

type FormWithFields = FormTemplate & { fields: FormField[] };

interface HubTeam {
  linear_team_id: string;
  linear_team_name: string | null;
}

interface FormBuilderProps {
  form: FormWithFields | null;
  hubId?: string;
  hubTeams?: HubTeam[];
}

export const BUTTON_ICONS: Record<string, LucideIcon> = {
  bug: Bug,
  lightbulb: Lightbulb,
  "file-text": FileText,
  calendar: Calendar,
  "message-square": MessageSquare,
  "help-circle": HelpCircle,
  wrench: Wrench,
  flag: Flag,
  star: Star,
  zap: Zap,
  shield: Shield,
  users: Users,
  mail: Mail,
  phone: Phone,
  megaphone: Megaphone,
};

interface FieldDraft {
  id: string;
  field_key: string;
  field_type: FormFieldType;
  label: string;
  description: string;
  placeholder: string;
  is_required: boolean;
  is_removable: boolean;
  is_hidden: boolean;
  linear_field: LinearFieldMapping | null;
  options: Array<{ value: string; label: string }>;
  default_value: string;
  display_order: number;
}

interface TeamOption {
  linear_id: string;
  name: string;
  key: string;
}

interface ProjectOption {
  linear_id: string;
  name: string;
}

interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Text Area" },
  { value: "select", label: "Select" },
  { value: "radio", label: "Radio" },
  { value: "checkbox", label: "Checkbox" },
  { value: "url", label: "URL" },
  { value: "file", label: "File" },
];

const FIELD_TYPE_BADGE: Record<string, { bg: string; text: string }> = {
  text: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)" },
  textarea: { bg: "var(--badge-blue-bg)", text: "var(--badge-blue-text)" },
  select: { bg: "var(--badge-purple-bg)", text: "var(--badge-purple-text)" },
  radio: { bg: "var(--badge-purple-bg)", text: "var(--badge-purple-text)" },
  checkbox: { bg: "var(--badge-green-bg)", text: "var(--badge-green-text)" },
  url: { bg: "var(--badge-yellow-bg)", text: "var(--badge-yellow-text)" },
  file: { bg: "var(--badge-orange-bg)", text: "var(--badge-orange-text)" },
};

const PRIORITY_OPTIONS = [
  { value: "0", label: "No priority" },
  { value: "1", label: "Urgent" },
  { value: "2", label: "High" },
  { value: "3", label: "Medium" },
  { value: "4", label: "Low" },
];

function makeFieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    || "field";
}

function newFieldDraft(order: number): FieldDraft {
  return {
    id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    field_key: "",
    field_type: "text",
    label: "",
    description: "",
    placeholder: "",
    is_required: false,
    is_removable: true,
    is_hidden: false,
    linear_field: null,
    options: [],
    default_value: "",
    display_order: order,
  };
}

function fieldFromApi(f: FormField): FieldDraft {
  return {
    id: f.id,
    field_key: f.field_key,
    field_type: f.field_type,
    label: f.label,
    description: f.description ?? "",
    placeholder: f.placeholder ?? "",
    is_required: f.is_required,
    is_removable: f.is_removable,
    is_hidden: f.is_hidden,
    linear_field: f.linear_field,
    options: f.options ?? [],
    default_value: f.default_value ?? "",
    display_order: f.display_order,
  };
}

const inputClass =
  "w-full px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent";

export function FormBuilder({ form, hubId, hubTeams }: FormBuilderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isNew = !form;
  const isGlobal = !hubId && !form?.hub_id;

  // Form settings
  const [name, setName] = useState(form?.name ?? "");
  const [type, setType] = useState<"bug" | "feature" | "custom">(form?.type ?? "custom");
  const [description, setDescription] = useState(form?.description ?? "");
  const [confirmationMessage, setConfirmationMessage] = useState(
    form?.confirmation_message ?? "Thank you! Your request has been submitted."
  );
  const [errorMessage, setErrorMessage] = useState(
    form?.error_message ?? "Something went wrong. Please try again."
  );
  const [isActive, setIsActive] = useState(form?.is_active ?? false);
  const [buttonLabel, setButtonLabel] = useState(form?.button_label ?? "");
  const [buttonIcon, setButtonIcon] = useState(form?.button_icon ?? "");

  // Linear routing
  const [targetTeamId, setTargetTeamId] = useState(form?.target_team_id ?? "");
  const [targetProjectId, setTargetProjectId] = useState(form?.target_project_id ?? "");
  const [targetLabelIds, setTargetLabelIds] = useState<string[]>(
    form?.target_label_ids ?? []
  );
  const [targetPriority, setTargetPriority] = useState(
    form?.target_priority?.toString() ?? ""
  );

  // Fields
  const [fields, setFields] = useState<FieldDraft[]>(
    form?.fields
      ? [...form.fields]
          .sort((a, b) => a.display_order - b.display_order)
          .map(fieldFromApi)
      : []
  );
  const [expandedField, setExpandedField] = useState<string | null>(null);
  const [addingField, setAddingField] = useState(false);
  const [newFieldType, setNewFieldType] = useState<FormFieldType>("text");
  const [newFieldLabel, setNewFieldLabel] = useState("");

  // Use hub team mappings for team selection (routing is set at hub level for global forms)
  const teams: TeamOption[] = (hubTeams ?? []).map((t) => ({
    linear_id: t.linear_team_id,
    name: t.linear_team_name ?? t.linear_team_id,
    key: "",
  }));
  const { data: projects } = useFetch<ProjectOption[]>(
    !isGlobal && targetTeamId
      ? `/api/admin/linear/teams/${targetTeamId}/projects`
      : null
  );
  const { data: workspaceLabels, loading: labelsLoading } = useFetch<LinearLabel[]>(
    "/api/admin/linear/labels"
  );

  // Reset project when team changes
  useEffect(() => {
    if (targetTeamId && form?.target_team_id !== targetTeamId) {
      setTargetProjectId("");
    }
  }, [targetTeamId, form?.target_team_id]);

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleFieldDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setFields((prev) => {
      const visibleIds = prev.filter((f) => f.linear_field !== "priority").map((f) => f.id);
      const oldIndex = visibleIds.indexOf(active.id as string);
      const newIndex = visibleIds.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prev;

      const reorderedVisible = arrayMove(
        prev.filter((f) => f.linear_field !== "priority"),
        oldIndex,
        newIndex
      );
      const priorityFields = prev.filter((f) => f.linear_field === "priority");
      return [...reorderedVisible, ...priorityFields].map((f, i) => ({
        ...f,
        display_order: i,
      }));
    });
  }, []);

  const removeField = useCallback((id: string) => {
    setFields((prev) =>
      prev.filter((f) => f.id !== id).map((f, i) => ({ ...f, display_order: i }))
    );
  }, []);

  const updateField = useCallback((id: string, patch: Partial<FieldDraft>) => {
    setFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
    );
  }, []);

  const addField = useCallback(() => {
    if (!newFieldLabel.trim()) return;
    const draft = newFieldDraft(fields.length);
    draft.field_type = newFieldType;
    draft.label = newFieldLabel.trim();
    draft.field_key = makeFieldKey(newFieldLabel.trim());
    setFields((prev) => [...prev, draft]);
    setNewFieldLabel("");
    setNewFieldType("text");
    setAddingField(false);
    setExpandedField(draft.id);
  }, [newFieldLabel, newFieldType, fields.length]);

  // Save
  const save = useCallback(() => {
    if (!name.trim()) {
      toast.error("Form name is required");
      return;
    }

    startTransition(async () => {
      try {
        const body = {
          name: name.trim(),
          type,
          description: description.trim() || null,
          is_active: isActive,
          button_label: buttonLabel.trim() || null,
          button_icon: buttonIcon || null,
          confirmation_message: confirmationMessage.trim(),
          error_message: errorMessage.trim(),
          target_label_ids: targetLabelIds.length > 0 ? targetLabelIds : null,
          target_priority:
            targetPriority === "" || targetPriority == null
              ? null
              : parseInt(targetPriority, 10),
          ...(isGlobal
            ? {}
            : {
                target_team_id: targetTeamId || null,
                target_project_id: targetProjectId || null,
              }),
          fields: fields.map((f) => ({
            id: f.id.startsWith("new-") ? undefined : f.id,
            field_key: f.field_key || makeFieldKey(f.label),
            field_type: f.field_type,
            label: f.label,
            description: f.description || null,
            placeholder: f.placeholder || null,
            is_required: f.is_required,
            is_removable: f.is_removable,
            is_hidden: f.is_hidden,
            linear_field: f.linear_field,
            options: f.options,
            default_value: f.default_value || null,
            display_order: f.display_order,
          })),
        };

        const url = isNew
          ? hubId
            ? `/api/admin/hubs/${hubId}/forms`
            : "/api/admin/forms"
          : `/api/admin/forms/${form.id}`;
        const method = isNew ? "POST" : "PATCH";

        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = (await res.json()) as { error?: string };
          throw new Error(err.error ?? "Failed to save form");
        }

        const saved = (await res.json()) as { id: string };
        toast.success(isNew ? "Form created" : "Form saved");
        captureEvent(POSTHOG_EVENTS.form_builder_saved, {
          isNewForm: isNew,
          formType: body.type,
          fieldCount: body.fields?.length ?? 0,
        });

        if (isNew) {
          if (hubId) {
            router.replace(`/admin/hubs/${hubId}/settings?tab=forms`);
          } else {
            router.replace(`/admin/forms/${saved.id}`);
          }
        }
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to save");
      }
    });
  }, [
    name, type, description, isActive, buttonLabel, buttonIcon,
    confirmationMessage, errorMessage,
    targetTeamId, targetProjectId, targetLabelIds, targetPriority,
    fields, isNew, form, router, hubId, isGlobal,
  ]);

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">
          {isNew ? "New Form" : form.name}
        </h1>
        <div className="flex items-center gap-3">
          {/* Active toggle */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {isActive ? "Active" : "Draft"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={isActive}
              onClick={() => setIsActive(!isActive)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                isActive ? "bg-primary" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
                  isActive ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>
          <button
            onClick={save}
            disabled={!name.trim() || isPending}
            className={cn(
              "px-4 py-2 text-sm font-medium rounded-md transition-colors",
              name.trim()
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            {isPending ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {/* Section 1: Form Settings */}
        <section className="border border-border rounded-lg bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Form Settings</h2>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label htmlFor="form-name" className="block text-sm font-medium mb-1.5">
                Name
              </label>
              <input
                id="form-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Bug Report"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="form-type" className="block text-sm font-medium mb-1.5">
                Type
              </label>
              <select
                id="form-type"
                value={type}
                onChange={(e) => setType(e.target.value as "bug" | "feature" | "custom")}
                className={inputClass}
              >
                <option value="bug">Bug Report</option>
                <option value="feature">Feature Request</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div>
              <label htmlFor="form-description" className="block text-sm font-medium mb-1.5">
                Description
              </label>
              <textarea
                id="form-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this form is for..."
                rows={2}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="form-confirmation" className="block text-sm font-medium mb-1.5">
                Confirmation Message
              </label>
              <textarea
                id="form-confirmation"
                value={confirmationMessage}
                onChange={(e) => setConfirmationMessage(e.target.value)}
                rows={2}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="form-error" className="block text-sm font-medium mb-1.5">
                Error Message
              </label>
              <textarea
                id="form-error"
                value={errorMessage}
                onChange={(e) => setErrorMessage(e.target.value)}
                rows={2}
                className={inputClass}
              />
            </div>
          </div>
        </section>

        {/* Section 2: Button Settings */}
        <section className="border border-border rounded-lg bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Button Settings</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Customize how the form button appears in the hub sidebar
            </p>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label htmlFor="button-label" className="block text-sm font-medium mb-1.5">
                Button Label
              </label>
              <input
                id="button-label"
                type="text"
                value={buttonLabel}
                onChange={(e) => setButtonLabel(e.target.value)}
                placeholder="Leave blank to use form name"
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                Button Icon
              </label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(BUTTON_ICONS).map(([key, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setButtonIcon(buttonIcon === key ? "" : key)}
                    className={cn(
                      "p-2 rounded-md border transition-colors",
                      buttonIcon === key
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    )}
                    title={key}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                ))}
              </div>
              {buttonIcon && (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Selected: {buttonIcon}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Section 3: Linear Defaults — shown for all forms */}
        <section className="border border-border rounded-lg bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Linear Defaults</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Defaults applied to all issues created from this form
            </p>
          </div>
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">
                Default Labels
              </label>
              <LabelPicker
                labels={workspaceLabels ?? []}
                loading={labelsLoading}
                selected={targetLabelIds}
                onChange={setTargetLabelIds}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Labels automatically applied to created issues
              </p>
            </div>

            <div>
              <label htmlFor="target-priority" className="block text-sm font-medium mb-1.5">
                Default Priority
              </label>
              <select
                id="target-priority"
                value={targetPriority}
                onChange={(e) => setTargetPriority(e.target.value)}
                className={inputClass}
              >
                <option value="">Inherit from Linear</option>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Section 4: Linear Routing — only shown for hub-specific forms */}
        {!isGlobal && (
          <section className="border border-border rounded-lg bg-card">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-semibold">Linear Routing</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Where submitted issues are created in Linear
              </p>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label htmlFor="target-team" className="block text-sm font-medium mb-1.5">
                  Target Team
                </label>
                <select
                  id="target-team"
                  value={targetTeamId}
                  onChange={(e) => setTargetTeamId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select a team...</option>
                  {teams.map((t) => (
                    <option key={t.linear_id} value={t.linear_id}>
                      {t.name}{t.key ? ` (${t.key})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="target-project" className="block text-sm font-medium mb-1.5">
                  Target Project
                </label>
                <select
                  id="target-project"
                  value={targetProjectId}
                  onChange={(e) => setTargetProjectId(e.target.value)}
                  disabled={!targetTeamId}
                  className={cn(inputClass, !targetTeamId && "opacity-50")}
                >
                  <option value="">
                    {targetTeamId ? "Select a project..." : "Select a team first"}
                  </option>
                  {(projects ?? []).map((p) => (
                    <option key={p.linear_id} value={p.linear_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>
        )}

        {/* Section: Form Options */}
        <section className="border border-border rounded-lg bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Form Options</h2>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium">Allow submitters to set priority</span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Show a priority picker on the form
                </p>
              </div>
              <ToggleSwitch
                label=""
                aria-label="Allow submitters to set priority"
                checked={fields.some((f) => f.linear_field === "priority")}
                onChange={(enabled) => {
                  if (enabled) {
                    setFields((prev) => [
                      ...prev,
                      {
                        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        field_key: "priority",
                        field_type: "select",
                        label: "Priority",
                        description: "",
                        placeholder: "",
                        is_required: false,
                        is_removable: false,
                        is_hidden: false,
                        linear_field: "priority",
                        options: [
                          { value: "2", label: "High" },
                          { value: "3", label: "Medium" },
                          { value: "4", label: "Low" },
                        ],
                        default_value: "",
                        display_order: 999,
                      },
                    ]);
                  } else {
                    setFields((prev) =>
                      prev
                        .filter((f) => f.linear_field !== "priority")
                        .map((f, i) => ({ ...f, display_order: i }))
                    );
                  }
                }}
              />
            </div>
            {fields.some((f) => f.linear_field === "priority") && (
              <div className="flex items-center justify-between pl-4 border-l-2 border-border ml-1">
                <div>
                  <span className="text-sm font-medium">Require priority</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Submitters must select a priority level
                  </p>
                </div>
                <ToggleSwitch
                  label=""
                  aria-label="Require priority selection"
                  checked={fields.find((f) => f.linear_field === "priority")?.is_required ?? false}
                  onChange={(required) => {
                    setFields((prev) =>
                      prev.map((f) =>
                        f.linear_field === "priority"
                          ? { ...f, is_required: required }
                          : f
                      )
                    );
                  }}
                />
              </div>
            )}
          </div>
        </section>

        {/* Section 5: Fields */}
        <section className="border border-border rounded-lg bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-semibold">Fields</h2>
            {(() => {
              const count = fields.filter((f) => f.linear_field !== "priority").length;
              return (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {count} field{count !== 1 ? "s" : ""}
                </p>
              );
            })()}
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleFieldDragEnd}
          >
            {(() => {
              const visibleFields = fields.filter((f) => f.linear_field !== "priority");
              return (
                <SortableContext
                  items={visibleFields.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div>
                    {visibleFields.map((field) => (
                      <SortableFieldRow
                        key={field.id}
                        field={field}
                        isExpanded={expandedField === field.id}
                        onToggleExpand={() =>
                          setExpandedField(expandedField === field.id ? null : field.id)
                        }
                        onUpdate={updateField}
                        onRemove={removeField}
                        inputClass={inputClass}
                      />
                    ))}
                  </div>
                </SortableContext>
              );
            })()}
          </DndContext>

          {/* Add field */}
          <div className="px-4 py-3">
            {addingField ? (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1">
                    Label
                  </label>
                  <input
                    type="text"
                    value={newFieldLabel}
                    onChange={(e) => setNewFieldLabel(e.target.value)}
                    placeholder="Field label"
                    className={inputClass}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addField();
                      if (e.key === "Escape") setAddingField(false);
                    }}
                  />
                </div>
                <div className="w-32">
                  <label className="block text-xs font-medium mb-1">
                    Type
                  </label>
                  <select
                    value={newFieldType}
                    onChange={(e) =>
                      setNewFieldType(e.target.value as FormFieldType)
                    }
                    className={inputClass}
                  >
                    {FIELD_TYPES.map((ft) => (
                      <option key={ft.value} value={ft.value}>
                        {ft.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={addField}
                  disabled={!newFieldLabel.trim()}
                  className={cn(
                    "px-3 py-2 text-sm font-medium rounded-md transition-colors",
                    newFieldLabel.trim()
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  Add
                </button>
                <button
                  onClick={() => setAddingField(false)}
                  className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingField(true)}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Field
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SortableFieldRow({
  field,
  isExpanded,
  onToggleExpand,
  onUpdate,
  onRemove,
  inputClass,
}: {
  field: FieldDraft;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (id: string, patch: Partial<FieldDraft>) => void;
  onRemove: (id: string) => void;
  inputClass: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const badge = FIELD_TYPE_BADGE[field.field_type] ?? FIELD_TYPE_BADGE.text;
  const hasOptions =
    field.field_type === "select" ||
    field.field_type === "radio" ||
    field.field_type === "checkbox";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-b border-border last:border-b-0",
        isExpanded && "bg-muted/20",
        isDragging && "relative z-10 shadow-md opacity-90 bg-card"
      )}
    >
      {/* Field row */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={onToggleExpand}
      >
        <button
          aria-label="Drag to reorder"
          className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground shrink-0 touch-none"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>

        {/* Type badge */}
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
          style={{ backgroundColor: badge.bg, color: badge.text }}
        >
          {field.field_type}
        </span>

        {/* Label */}
        <span className="text-sm flex-1 truncate">
          {field.label || (
            <span className="text-muted-foreground italic">
              Untitled
            </span>
          )}
        </span>

        {/* Linear mapping indicator */}
        {field.linear_field && (
          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted">
            {field.linear_field}
          </span>
        )}

        {/* Required indicator */}
        {field.is_required && (
          <span className="text-[10px] text-destructive font-medium">
            Required
          </span>
        )}

        {/* Hidden indicator */}
        {field.is_hidden && (
          <span className="text-[10px] text-muted-foreground">
            Hidden
          </span>
        )}

        {/* Remove action */}
        <div className="flex items-center shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(field.id);
            }}
            disabled={!field.is_removable}
            className={cn(
              "p-1 rounded transition-colors",
              !field.is_removable
                ? "text-muted-foreground/30 cursor-not-allowed"
                : "text-muted-foreground hover:text-destructive"
            )}
            title={
              field.is_removable
                ? "Remove field"
                : "This field cannot be removed"
            }
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded field detail */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">
                Label
              </label>
              <input
                type="text"
                value={field.label}
                onChange={(e) =>
                  onUpdate(field.id, {
                    label: e.target.value,
                    field_key:
                      field.field_key || makeFieldKey(e.target.value),
                  })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">
                Type
              </label>
              <select
                value={field.field_type}
                onChange={(e) =>
                  onUpdate(field.id, {
                    field_type: e.target.value as FormFieldType,
                  })
                }
                className={inputClass}
              >
                {FIELD_TYPES.map((ft) => (
                  <option key={ft.value} value={ft.value}>
                    {ft.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              Placeholder
            </label>
            <input
              type="text"
              value={field.placeholder}
              onChange={(e) =>
                onUpdate(field.id, { placeholder: e.target.value })
              }
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              Description
            </label>
            <input
              type="text"
              value={field.description}
              onChange={(e) =>
                onUpdate(field.id, { description: e.target.value })
              }
              placeholder="Help text shown below the field"
              className={inputClass}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">
              Default Value
            </label>
            <input
              type="text"
              value={field.default_value}
              onChange={(e) =>
                onUpdate(field.id, {
                  default_value: e.target.value,
                })
              }
              className={inputClass}
            />
          </div>

          {/* Options editor for select/radio/checkbox */}
          {hasOptions && (
            <OptionsEditor
              options={field.options}
              onChange={(options) =>
                onUpdate(field.id, { options })
              }
            />
          )}

          {/* Toggles row */}
          <div className="flex items-center gap-6 pt-1">
            <ToggleSwitch
              label="Required"
              checked={field.is_required}
              onChange={(v) =>
                onUpdate(field.id, { is_required: v })
              }
            />
            {field.linear_field && (
              <ToggleSwitch
                label="Hidden"
                checked={field.is_hidden}
                onChange={(v) =>
                  onUpdate(field.id, { is_hidden: v })
                }
              />
            )}
          </div>

          {/* Linear field mapping */}
          <div>
            <label className="block text-xs font-medium mb-1">
              Linear Field Mapping
            </label>
            <select
              value={field.linear_field ?? ""}
              onChange={(e) =>
                onUpdate(field.id, {
                  linear_field:
                    (e.target.value as LinearFieldMapping) || null,
                })
              }
              className={inputClass}
            >
              <option value="">None</option>
              <option value="title">Title</option>
              <option value="description">Description</option>
              <option value="priority">Priority</option>
              <option value="label_ids">Labels</option>
              <option value="project_id">Project</option>
              <option value="cycle_id">Cycle</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}

function LabelPicker({
  labels,
  loading,
  selected,
  onChange,
}: {
  labels: LinearLabel[];
  loading: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const filtered = labels.filter((l) =>
    l.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id]
    );
  };

  const selectedLabels = labels.filter((l) => selected.includes(l.id));

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          inputClass,
          "text-left flex items-center justify-between cursor-pointer"
        )}
      >
        <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>
          {loading
            ? "Loading labels..."
            : selected.length === 0
              ? "Select labels..."
              : `${selected.length} label${selected.length !== 1 ? "s" : ""} selected`}
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      {selectedLabels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {selectedLabels.map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-foreground"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(label.id);
                }}
                aria-label={`Remove ${label.name}`}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-full border border-border rounded-lg bg-popover shadow-lg">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
            <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter labels..."
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No labels found</div>
            ) : (
              filtered.map((label) => {
                const isSelected = selected.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    onClick={() => toggle(label.id)}
                    className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left hover:bg-accent/50 transition-colors"
                  >
                    <span className={cn(
                      "flex items-center justify-center w-4 h-4 rounded border shrink-0 transition-colors",
                      isSelected
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border"
                    )}>
                      {isSelected && <Check className="w-3 h-3" />}
                    </span>
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: label.color }}
                    />
                    <span className="truncate">{label.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleSwitch({
  label,
  checked,
  onChange,
  "aria-label": ariaLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel || label || undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          checked ? "bg-primary" : "bg-muted"
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-4" : "translate-x-0"
          )}
        />
      </button>
      <span className="text-xs font-medium">{label}</span>
    </label>
  );
}

function OptionsEditor({
  options,
  onChange,
}: {
  options: Array<{ value: string; label: string }>;
  onChange: (opts: Array<{ value: string; label: string }>) => void;
}) {
  const [newOption, setNewOption] = useState("");

  const addOption = () => {
    if (!newOption.trim()) return;
    const value = newOption
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
    onChange([...options, { value, label: newOption.trim() }]);
    setNewOption("");
  };

  return (
    <div>
      <label className="block text-xs font-medium mb-1">Options</label>
      <div className="space-y-1.5">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={opt.label}
              onChange={(e) => {
                const next = [...options];
                next[i] = { ...next[i], label: e.target.value };
                onChange(next);
              }}
              className={cn(inputClass, "flex-1")}
            />
            <button
              onClick={() => onChange(options.filter((_, j) => j !== i))}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newOption}
            onChange={(e) => setNewOption(e.target.value)}
            placeholder="Add option..."
            className={cn(inputClass, "flex-1")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOption();
              }
            }}
          />
          <button
            onClick={addOption}
            disabled={!newOption.trim()}
            className={cn(
              "p-1.5 rounded-md transition-colors",
              newOption.trim()
                ? "text-primary hover:bg-accent"
                : "text-muted-foreground/30"
            )}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
