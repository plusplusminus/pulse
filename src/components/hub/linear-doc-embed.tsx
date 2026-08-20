"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { linearImageComponents } from "@/lib/image-proxy";
import { FileText, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type DocData = {
  title: string;
  content: string;
  icon: string | null;
  color: string | null;
  updatedAt: string;
  creatorName: string | null;
};

const LINEAR_DOC_RE =
  /^https?:\/\/linear\.app\/[^/]+\/document\/[^/]+-([a-f0-9]+)\/?$/;

/**
 * Extract the slugId from a Linear document URL.
 * Returns null if the URL is not a Linear document link.
 */
export function extractLinearDocSlug(href: string): string | null {
  const m = href.match(LINEAR_DOC_RE);
  return m?.[1] ?? null;
}

export function LinearDocEmbed({
  href,
  hubId,
  linkText,
}: {
  href: string;
  hubId: string;
  linkText: string;
}) {
  const slugId = extractLinearDocSlug(href);
  const [doc, setDoc] = useState<DocData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded || doc || loading || !slugId) return;

    setLoading(true);
    fetch(`/api/hub/${hubId}/linear-doc/${slugId}`)
      .then((res) => {
        if (!res.ok) throw new Error("fetch failed");
        return res.json() as Promise<DocData>;
      })
      .then((data) => setDoc(data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [expanded, doc, loading, slugId, hubId]);

  const displayTitle = doc?.title ?? linkText ?? "Document";
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <div className="my-2 rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          "flex items-center gap-2 w-full px-3 py-2 text-left text-sm font-medium",
          "hover:bg-muted/50 transition-colors"
        )}
      >
        <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="truncate flex-1">{displayTitle}</span>
        <Chevron className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-4">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading document...
            </div>
          )}
          {error && (
            <p className="text-xs text-muted-foreground">
              Could not load document.{" "}
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Open in Linear
              </a>
            </p>
          )}
          {doc && (
            <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-sm prose-headings:font-semibold prose-headings:mt-6 prose-headings:mb-2 prose-p:text-[13px] prose-p:leading-relaxed prose-p:my-2.5 prose-code:text-xs prose-pre:text-xs prose-pre:my-3 prose-ul:text-[13px] prose-ul:my-2.5 prose-ol:text-[13px] prose-ol:my-2.5 prose-li:my-0.5 prose-hr:my-5">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={linearImageComponents}
              >
                {doc.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
