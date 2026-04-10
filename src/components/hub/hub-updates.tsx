"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linearImageComponents } from "@/lib/image-proxy";
import { cn } from "@/lib/utils";
import { ChevronRight, FileText, Loader2 } from "lucide-react";

type HubUpdate = {
  id: string;
  body: string;
  health: string;
  createdAt: string;
  projectName: string;
  projectColor: string | null;
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

export function HubUpdates({ hubId }: { hubId: string }) {
  const [updates, setUpdates] = useState<HubUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchUpdates() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/hub/${hubId}/updates`);
        const data = (await res.json()) as {
          updates?: HubUpdate[];
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
  }, [hubId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-border rounded-lg p-10 bg-card text-center">
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (updates.length === 0) {
    return (
      <div className="border border-border rounded-lg p-10 bg-card text-center">
        <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium mb-1">No updates yet</p>
        <p className="text-xs text-muted-foreground">
          Project updates will appear here as they are posted.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {updates.map((update, i) => (
        <UpdateCard key={update.id} update={update} defaultExpanded={i === 0} />
      ))}
    </div>
  );
}

function UpdateCard({
  update,
  defaultExpanded,
}: {
  update: HubUpdate;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  // Extract first line of markdown as a preview for collapsed state
  const preview = update.body.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 120) || "";

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2 w-full px-4 py-3 text-left transition-colors",
          !expanded && "hover:bg-accent/50"
        )}
      >
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform",
            expanded && "rotate-90"
          )}
        />
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{
            backgroundColor:
              update.projectColor || "var(--muted-foreground)",
          }}
        />
        <span className="text-xs font-medium truncate">
          {update.projectName}
        </span>
        <HealthBadge health={update.health} />
        {!expanded && (
          <span className="text-xs text-muted-foreground truncate hidden sm:block">
            {preview}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
          {formatUpdateDate(update.createdAt)}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-0">
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-sm prose-headings:font-semibold prose-p:text-[13px] prose-p:leading-relaxed prose-code:text-xs prose-pre:text-xs prose-ul:text-[13px] prose-ol:text-[13px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={linearImageComponents}>
              {update.body}
            </ReactMarkdown>
          </div>
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
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0"
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
