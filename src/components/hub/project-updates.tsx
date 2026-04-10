"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linearImageComponents } from "@/lib/image-proxy";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";

type ProjectUpdate = {
  id: string;
  body: string;
  health: string;
  createdAt: string;
  updatedAt: string;
};

function getHealthColor(health: string): string {
  switch (health.toLowerCase()) {
    case "ontrack":
      return "var(--color-green-500, #22c55e)";
    case "atrisk":
      return "var(--color-yellow-500, #eab308)";
    case "offtrack":
      return "var(--color-red-500, #ef4444)";
    default:
      return "var(--muted-foreground)";
  }
}

function getHealthLabel(health: string): string {
  switch (health.toLowerCase()) {
    case "ontrack":
      return "On Track";
    case "atrisk":
      return "At Risk";
    case "offtrack":
      return "Off Track";
    default:
      return health;
  }
}

function formatUpdateDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export function ProjectUpdates({
  hubId,
  projectId,
}: {
  hubId: string;
  projectId: string;
}) {
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchUpdates() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `/api/hub/${hubId}/projects/${projectId}/updates`
        );
        const data = (await res.json()) as {
          updates?: ProjectUpdate[];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || "Failed to fetch updates");
        }
        if (!cancelled) {
          setUpdates(data.updates ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load updates"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchUpdates();
    return () => {
      cancelled = true;
    };
  }, [hubId, projectId]);

  // Don't render anything while loading or if no updates
  if (loading || (!error && updates.length === 0)) {
    return null;
  }

  return (
    <div className="border-b border-border">
      {/* Section header — collapsible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-6 py-3 text-left hover:bg-accent/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        <span className="text-xs font-semibold">Project Updates</span>
        {!loading && updates.length > 0 && (
          <span className="text-[10px] text-muted-foreground">
            ({updates.length})
          </span>
        )}
        {/* Show latest health badge inline when collapsed */}
        {!expanded && !loading && updates.length > 0 && (
          <HealthBadge health={updates[0].health} />
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-6 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
            </div>
          ) : error ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              {error}
            </p>
          ) : (
            <div className="space-y-3">
              {updates.map((update) => (
                <div
                  key={update.id}
                  className="rounded-lg border border-border bg-muted/30 p-4"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <HealthBadge health={update.health} />
                    <span className="text-[10px] text-muted-foreground">
                      {formatUpdateDate(update.createdAt)}
                    </span>
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-sm prose-headings:font-semibold prose-p:text-[13px] prose-p:leading-relaxed prose-code:text-xs prose-pre:text-xs prose-ul:text-[13px] prose-ol:text-[13px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={linearImageComponents}>
                      {update.body}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HealthBadge({ health }: { health: string }) {
  const color = getHealthColor(health);
  const label = getHealthLabel(health);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium"
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}
