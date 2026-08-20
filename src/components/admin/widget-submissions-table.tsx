"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useFetch } from "@/hooks/use-fetch";
import {
  Camera,
  ExternalLink,
  Film,
  Loader2,
  MousePointerClick,
  PlayCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  submissionArtefacts,
  type ArtefactState,
  type SubmissionArtefacts,
} from "@/lib/widget-artefacts";
import type { WidgetSubmission } from "@/lib/widget-types";

interface WidgetSubmissionsTableProps {
  hubId: string;
}

type TypeFilter = "all" | "bug" | "feedback" | "idea";
type StatusFilter = "all" | "synced" | "failed" | "pending";

const COLUMNS =
  "grid-cols-[110px_minmax(0,1fr)_76px_150px_116px_84px_92px]";

export function WidgetSubmissionsTable({ hubId }: WidgetSubmissionsTableProps) {
  const {
    data: submissions,
    loading,
    refetch,
  } = useFetch<WidgetSubmission[]>(
    `/api/widget/submissions?hubId=${hubId}`
  );

  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const filtered = (submissions ?? []).filter((s) => {
    if (typeFilter !== "all" && s.type !== typeFilter) return false;
    if (statusFilter !== "all" && s.sync_status !== statusFilter) return false;
    return true;
  });

  const retrySync = async (submissionId: string) => {
    setRetryingId(submissionId);
    try {
      const res = await fetch(
        `/api/widget/submissions/${submissionId}/retry`,
        { method: "POST" }
      );
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Retry failed");
      }
      toast.success("Sync retried");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetryingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading submissions...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All types</option>
          <option value="bug">Bug</option>
          <option value="feedback">Feedback</option>
          <option value="idea">Idea</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-3 py-1.5 text-sm border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All statuses</option>
          <option value="synced">Synced</option>
          <option value="failed">Failed</option>
          <option value="pending">Pending</option>
        </select>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} submission{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden bg-card">
        {/* Header */}
        <div
          className={cn(
            "grid gap-2 px-4 py-2 bg-muted/30 border-b border-border",
            COLUMNS
          )}
        >
          {["Date", "Title", "Type", "Reporter", "Artefacts", "Status", "Linear"].map(
            (label) => (
              <span
                key={label}
                className="text-xs font-medium text-muted-foreground"
              >
                {label}
              </span>
            )
          )}
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No submissions found.
          </div>
        ) : (
          filtered.map((sub, i) => (
            <div
              key={sub.id}
              className={cn(
                "relative grid gap-2 px-4 py-2.5 items-center hover:bg-accent/30 transition-colors",
                COLUMNS,
                i < filtered.length - 1 && "border-b border-border"
              )}
            >
              {/* Whole-row link. Absolute rather than wrapping the row so the
                  Linear link and retry button stay valid, clickable elements. */}
              <Link
                href={`/admin/hubs/${hubId}/widget/submissions/${sub.id}`}
                aria-label={`Open submission: ${sub.title}`}
                className="absolute inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              />

              <span className="text-xs text-muted-foreground tabular-nums">
                {new Date(sub.created_at).toLocaleDateString()}
              </span>
              <span className="text-sm truncate">{sub.title}</span>
              <TypeBadge type={sub.type} />
              <span className="text-xs text-muted-foreground truncate">
                {sub.reporter_email}
              </span>
              <ArtefactIcons artefacts={submissionArtefacts(sub)} />
              <StatusBadge
                status={sub.sync_status}
                error={sub.sync_error}
              />

              <span className="relative z-10 text-xs justify-self-start">
                {sub.linear_issue_url ? (
                  <a
                    href={sub.linear_issue_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    View
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : sub.sync_status === "failed" ? (
                  <button
                    type="button"
                    onClick={() => retrySync(sub.id)}
                    disabled={retryingId === sub.id}
                    title={sub.sync_error ?? "Retry Linear sync"}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border hover:bg-accent/50 disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw
                      className={cn(
                        "w-3 h-3",
                        retryingId === sub.id && "animate-spin"
                      )}
                    />
                    Retry
                  </button>
                ) : (
                  <span className="text-muted-foreground">--</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/**
 * PULSE-348 — which artefacts a row carries. Purged media (PULSE-317 nulls the
 * storage path and stamps `media_purged_at`) gets its own icon so a triaged row
 * is not mistaken for one that never had media.
 */
function ArtefactIcons({ artefacts }: { artefacts: SubmissionArtefacts }) {
  const { screenshot, video, replay, pickCount } = artefacts;

  if (!artefacts.hasAny) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  const purged = [screenshot, video, replay].some(
    (state) => state === "purged"
  );

  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      {pickCount > 0 && (
        <span
          title={`${pickCount} element pick${pickCount === 1 ? "" : "s"}`}
          className="inline-flex items-center gap-0.5"
        >
          <MousePointerClick className="w-3.5 h-3.5" />
          <span className="text-[10px] font-medium tabular-nums">
            {pickCount}
          </span>
        </span>
      )}
      <ArtefactIcon state={screenshot} label="Screenshot">
        <Camera className="w-3.5 h-3.5" />
      </ArtefactIcon>
      <ArtefactIcon state={video} label="Video">
        <Film className="w-3.5 h-3.5" />
      </ArtefactIcon>
      <ArtefactIcon state={replay} label="Session replay">
        <PlayCircle className="w-3.5 h-3.5" />
      </ArtefactIcon>
      {purged && (
        <span title="Media removed after the retention period">
          <Trash2 className="w-3.5 h-3.5 opacity-60" />
        </span>
      )}
    </span>
  );
}

function ArtefactIcon({
  state,
  label,
  children,
}: {
  state: ArtefactState;
  label: string;
  children: React.ReactNode;
}) {
  if (state !== "present") return null;
  return <span title={label}>{children}</span>;
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    bug: "bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]",
    feedback: "bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]",
    idea: "bg-[var(--badge-purple-bg,var(--badge-blue-bg))] text-[var(--badge-purple-text,var(--badge-blue-text))]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium w-fit",
        styles[type] ?? "bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)]"
      )}
    >
      {type.charAt(0).toUpperCase() + type.slice(1)}
    </span>
  );
}

function StatusBadge({
  status,
  error,
}: {
  status: string;
  error?: string | null;
}) {
  const styles: Record<string, string> = {
    synced: "bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]",
    failed: "bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]",
    pending: "bg-[var(--badge-yellow-bg)] text-[var(--badge-yellow-text)]",
  };

  return (
    <span
      title={error ?? undefined}
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium w-fit",
        styles[status] ?? "bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)]"
      )}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
