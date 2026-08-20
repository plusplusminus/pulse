"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useFetch } from "@/hooks/use-fetch";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Loader2,
  Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { WidgetSubmission } from "@/lib/widget-types";

interface WidgetSubmissionsTableProps {
  hubId: string;
}

type TypeFilter = "all" | "bug" | "feedback" | "idea";
type StatusFilter = "all" | "synced" | "failed" | "pending";

export function WidgetSubmissionsTable({ hubId }: WidgetSubmissionsTableProps) {
  const {
    data: submissions,
    loading,
    refetch,
  } = useFetch<WidgetSubmission[]>(
    `/api/widget/submissions?hubId=${hubId}`
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);
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
        <div className="grid grid-cols-[120px_1fr_80px_140px_80px_100px] gap-2 px-4 py-2 bg-muted/30 border-b border-border">
          <span className="text-xs font-medium text-muted-foreground">
            Date
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            Title
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            Type
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            Reporter
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            Status
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            Linear
          </span>
        </div>

        {/* Rows */}
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No submissions found.
          </div>
        ) : (
          filtered.map((sub, i) => {
            const isExpanded = expandedId === sub.id;
            return (
              <div
                key={sub.id}
                className={cn(
                  i < filtered.length - 1 && "border-b border-border"
                )}
              >
                {/* Row */}
                <button
                  onClick={() =>
                    setExpandedId(isExpanded ? null : sub.id)
                  }
                  className="w-full grid grid-cols-[120px_1fr_80px_140px_80px_100px] gap-2 px-4 py-2.5 text-left hover:bg-accent/30 transition-colors items-center"
                >
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {new Date(sub.created_at).toLocaleDateString()}
                  </span>
                  <span className="text-sm truncate flex items-center gap-1.5">
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    )}
                    {sub.title}
                  </span>
                  <TypeBadge type={sub.type} />
                  <span className="text-xs text-muted-foreground truncate">
                    {sub.reporter_email}
                  </span>
                  <StatusBadge status={sub.sync_status} />
                  <span className="text-xs">
                    {sub.linear_issue_url ? (
                      <a
                        href={sub.linear_issue_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        View
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </span>
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/50 bg-muted/10">
                    {sub.description && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Description
                        </p>
                        <p className="text-sm">{sub.description}</p>
                      </div>
                    )}

                    {sub.page_url && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Page URL
                        </p>
                        <a
                          href={sub.page_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline break-all"
                        >
                          {sub.page_url}
                        </a>
                      </div>
                    )}

                    {sub.screenshot_url && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Screenshot
                        </p>
                        <a
                          href={sub.screenshot_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          View screenshot
                        </a>
                      </div>
                    )}

                    {sub.metadata?.console &&
                      sub.metadata.console.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">
                            Console ({sub.metadata.console.length})
                          </p>
                          <div className="max-h-40 overflow-y-auto border border-border rounded-md bg-muted/30">
                            {sub.metadata.console.map((entry, idx) => (
                              <div
                                key={idx}
                                className={cn(
                                  "px-2.5 py-1 text-xs font-mono",
                                  idx > 0 && "border-t border-border/50",
                                  entry.level === "error" && "text-red-500",
                                  entry.level === "warn" &&
                                    "text-yellow-600 dark:text-yellow-500"
                                )}
                              >
                                <span className="text-muted-foreground mr-2">
                                  [{entry.level}]
                                </span>
                                {entry.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                    {sub.metadata?.sentry?.replayUrl && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Sentry Replay
                        </p>
                        <a
                          href={sub.metadata.sentry.replayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          Open replay
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    )}

                    {sub.metadata && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Metadata
                        </p>
                        <pre className="text-xs bg-muted/50 border border-border rounded-md p-2.5 overflow-x-auto font-mono max-h-48 overflow-y-auto">
                          {JSON.stringify(
                            {
                              url: sub.metadata.url,
                              userAgent: sub.metadata.userAgent,
                              viewport: sub.metadata.viewport,
                              timestamp: sub.metadata.timestamp,
                              custom: sub.metadata.custom,
                            },
                            null,
                            2
                          )}
                        </pre>
                      </div>
                    )}

                    {sub.sync_status === "failed" && (
                      <div className="flex items-center gap-3">
                        {sub.sync_error && (
                          <p className="text-xs text-red-500 flex-1">
                            {sub.sync_error}
                          </p>
                        )}
                        <button
                          onClick={() => retrySync(sub.id)}
                          disabled={retryingId === sub.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          <RefreshCw
                            className={cn(
                              "w-3.5 h-3.5",
                              retryingId === sub.id && "animate-spin"
                            )}
                          />
                          Retry Sync
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    synced: "bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]",
    failed: "bg-red-500/10 text-red-500",
    pending: "bg-[var(--badge-yellow-bg)] text-[var(--badge-yellow-text)]",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium w-fit",
        styles[status] ?? "bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)]"
      )}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
