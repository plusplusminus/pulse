"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { proxyLinearImageUrl } from "@/lib/image-proxy";
import { CommentComposer } from "./comment-composer";
import { AdminLinearConnectBanner } from "./admin-linear-connect-banner";
import { LabelEditor } from "./label-editor";
import { ImageLightbox } from "./image-lightbox";
import { useAdminLinearGate } from "@/hooks/use-admin-linear-gate";
import {
  X,
  Circle,
  CircleDot,
  CircleCheck,
  CircleX,
  CircleDashed,
  AlertTriangle,
  SignalHigh,
  SignalMedium,
  SignalLow,

  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  MessageSquare,
  AlertCircle,
  Loader2,
  History,
  ArrowRight,
  Tag,
  Reply,
  IterationCw,
  Zap,
  RotateCcw,
  FileText,
  FileSpreadsheet,
  Archive,
  File,
  Image,
  ImageOff,
  ExternalLink,
  Link,
  Check,
} from "lucide-react";

export type IssueDetail = {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  priority: number;
  priorityLabel: string;
  state: { id: string; name: string; color: string; type: string };
  labels: Array<{ id: string; name: string; color: string }>;
  cycle?: { id: string; name: string; number: number };
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
};

export type Comment = {
  id: string;
  linearId?: string;
  body: string;
  parentId?: string;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string };
  isHubComment?: boolean;
  isTeamComment?: boolean;
  push_status?: string;
  push_error?: string;
  children?: Comment[];
};

export type HistoryEntry = {
  id: string;
  createdAt: string;
  type: "state" | "priority" | "label" | "workflow";
  fromState?: { name: string; color: string; type: string };
  toState?: { name: string; color: string; type: string };
  fromPriority?: number;
  toPriority?: number;
  addedLabels?: Array<{ name: string; color: string }>;
  removedLabels?: Array<{ name: string; color: string }>;
  workflowActionType?: string;
  workflowActionConfig?: Record<string, unknown>;
  workflowResult?: "success" | "failure";
  workflowError?: string | null;
  workflowTriggerLabelId?: string;
};

// -- Custom ReactMarkdown components ─────────────────────────────────────────

const FILE_ICON_MAP: Record<string, typeof File> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  rtf: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  zip: Archive,
  rar: Archive,
  "7z": Archive,
  gz: Archive,
  tar: Archive,
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  webp: Image,
  svg: Image,
};

function getFileIcon(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICON_MAP[ext] ?? File;
}

function MarkdownImage({
  src,
  alt,
  onImageClick,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & {
  onImageClick: (src: string, alt?: string) => void;
}) {
  const [broken, setBroken] = useState(false);
  const imgSrc = typeof src === "string" ? proxyLinearImageUrl(src) : undefined;

  if (broken || !imgSrc) {
    return (
      <span className="flex items-center justify-center gap-2 w-full max-h-[300px] min-h-[80px] bg-muted rounded-lg border border-border text-muted-foreground text-xs">
        <ImageOff className="w-4 h-4" />
        Image not found
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      src={imgSrc}
      alt={alt ?? ""}
      role="button"
      tabIndex={0}
      aria-label={alt ? `View image: ${alt}` : "View image"}
      onError={() => setBroken(true)}
      onClick={(e) => {
        e.preventDefault();
        onImageClick(imgSrc, alt ?? undefined);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onImageClick(imgSrc, alt ?? undefined);
        }
      }}
      className="max-w-full max-h-[300px] rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity"
    />
  );
}

export function useMarkdownComponents(onImageClick: (src: string, alt?: string) => void): Components {
  return useMemo(() => ({
    img: (props: React.ComponentPropsWithoutRef<"img">) => (
      <MarkdownImage {...props} onImageClick={onImageClick} />
    ),
    a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<"a">) => {
      // Detect Supabase storage file attachment links
      if (href && href.includes("comment-attachments/")) {
        try {
          // Prefer the markdown link text (e.g. "report.pdf") over the UUID storage key
          const childText = typeof children === "string" ? children.trim() : "";
          const url = new URL(href, window.location.origin);
          const pathParts = url.pathname.split("/");
          const storageFilename = decodeURIComponent(pathParts[pathParts.length - 1]);
          const displayName = childText || storageFilename;
          const IconComponent = getFileIcon(displayName);

          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-muted/50 hover:bg-muted text-foreground no-underline transition-colors text-xs"
              {...props}
            >
              <IconComponent className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="truncate max-w-[200px]">{displayName}</span>
            </a>
          );
        } catch {
          // Malformed URL — fall through to regular link rendering
        }
      }

      // Regular links
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
  }), [onImageClick]);
}

export function IssueDetailPanel({
  issueId,
  hubId,
  isViewOnly,
  onClose,
  onIssueUpdate,
}: {
  issueId: string | null;
  hubId: string;
  isViewOnly?: boolean;
  onClose: () => void;
  onIssueUpdate?: (issueId: string, patch: Record<string, unknown>) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { blocked: adminLinearBlocked } = useAdminLinearGate();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [replyingTo, setReplyingTo] = useState<{ parentId: string; authorName: string } | null>(null);
  const [hubLabels, setHubLabels] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [workflowLabelIds, setWorkflowLabelIds] = useState<string[]>([]);
  const [workflowRules, setWorkflowRules] = useState<Array<{ labelId: string; triggerType: string; description: string }>>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [issueError, setIssueError] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [descOverflows, setDescOverflows] = useState(false);
  const descRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt?: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mdComponents = useMarkdownComponents((src, alt) => setLightboxImage({ src, alt }));

  // Track whether panel is being explicitly closed to avoid URL-driven reopen
  const [closing, setClosing] = useState(false);

  // Resolve active issue from prop or URL
  const activeId = closing ? null : (issueId ?? searchParams.get("issue"));

  const handleClose = useCallback(() => {
    setClosing(true);
    setIssue(null);
    setComments([]);
    setHubLabels([]);
    setWorkflowLabelIds([]);
    setWorkflowRules([]);
    setHistory([]);
    setDescExpanded(false);
    onClose();
    // Remove issue from URL params
    const params = new URLSearchParams(searchParams.toString());
    params.delete("issue");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : "?", { scroll: false });
  }, [onClose, router, searchParams]);

  // Reset closing flag when a new issue is selected via prop
  useEffect(() => {
    if (issueId) setClosing(false);
  }, [issueId]);

  // Build a standalone task URL: /hub/[slug]/[teamKey]/task/[issueId]
  const getTaskUrl = useCallback(() => {
    if (!activeId) return window.location.href;
    const segments = pathname.split("/").filter(Boolean);
    const hubIdx = segments.indexOf("hub");
    const slug = hubIdx >= 0 ? segments[hubIdx + 1] : undefined;
    const teamKey = hubIdx >= 0 ? segments[hubIdx + 2] : undefined;
    if (!slug || !teamKey) return window.location.href;
    return `${window.location.origin}/hub/${encodeURIComponent(slug)}/${encodeURIComponent(teamKey)}/task/${encodeURIComponent(activeId)}`;
  }, [activeId, pathname]);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getTaskUrl());
      setLinkCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // clipboard API unavailable — silently fail
    }
  }, [getTaskUrl]);

  // Clean up copy timer on unmount
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleOpenNewWindow = useCallback(() => {
    window.open(getTaskUrl(), "_blank", "noopener,noreferrer");
  }, [getTaskUrl]);

  // Fetch issue data
  useEffect(() => {
    if (!activeId) {
      setIssue(null);
      setComments([]);
      setHistory([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setIssueError(false);
    setIssue(null);
    setComments([]);
    setHubLabels([]);
    setWorkflowLabelIds([]);
    setWorkflowRules([]);
    setHistory([]);

    async function fetchIssue() {
      try {
        const [issueResult, historyResult] = await Promise.allSettled([
          fetch(`/api/hub/${hubId}/issues/${activeId}`),
          fetch(`/api/hub/${hubId}/issues/${activeId}/history`),
        ]);

        if (!cancelled) {
          if (issueResult.status === "fulfilled" && issueResult.value.ok) {
            const data = (await issueResult.value.json()) as {
              issue: IssueDetail;
              comments: Comment[];
              hubLabels: Array<{ id: string; name: string; color: string }>;
              workflowLabelIds?: string[];
              workflowRules?: Array<{ labelId: string; triggerType: string; description: string }>;
            };
            setIssue(data.issue);
            setComments(data.comments);
            setHubLabels(data.hubLabels ?? []);
            setWorkflowLabelIds(data.workflowLabelIds ?? []);
            setWorkflowRules(data.workflowRules ?? []);
          } else {
            setIssueError(true);
          }

          if (historyResult.status === "fulfilled" && historyResult.value.ok) {
            const historyData = (await historyResult.value.json()) as {
              history: HistoryEntry[];
            };
            setHistory(historyData.history ?? []);
          }
        }
      } catch {
        if (!cancelled) {
          setIssueError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchIssue();
    return () => { cancelled = true; };
  }, [activeId, hubId]);

  // Update URL when issue opens
  useEffect(() => {
    if (!issueId) return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("issue") !== issueId) {
      params.set("issue", issueId);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [issueId, router, searchParams]);

  // Escape key closes panel (skip if lightbox is open — it handles its own Escape)
  useEffect(() => {
    if (!activeId) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !lightboxImage) handleClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeId, handleClose, lightboxImage]);

  // Check description overflow
  useEffect(() => {
    if (descRef.current) {
      setDescOverflows(descRef.current.scrollHeight > 300);
    }
  }, [issue?.description]);

  // Track issue view
  useEffect(() => {
    if (issue) {
      captureEvent(POSTHOG_EVENTS.issue_viewed, { issueId: issue.identifier || issue.id });
    }
  }, [issue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOpen = !!activeId;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 bg-black/50 z-40 transition-opacity duration-200",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          "fixed top-0 right-0 h-full z-50 bg-background border-l border-border flex flex-col transition-transform duration-200 ease-out",
          "w-full sm:w-[480px]",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {loading && !issue ? (
          <div className="p-6 space-y-4">
            <div className="h-5 w-24 bg-muted/50 rounded animate-pulse" />
            <div className="h-6 w-64 bg-muted/50 rounded animate-pulse" />
            <div className="h-40 bg-muted/50 rounded animate-pulse" />
          </div>
        ) : issueError ? (
          <div className="flex flex-col items-center justify-center flex-1 p-6 text-center">
            <AlertCircle className="w-5 h-5 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">Failed to load task</p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Close
            </button>
          </div>
        ) : issue ? (
          <>
            {/* Header */}
            <div className="flex items-start justify-between p-4 border-b border-border shrink-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-muted-foreground">
                    {issue.identifier}
                  </span>
                  <StatusBadge state={issue.state} />
                  <PriorityIcon priority={issue.priority} />
                </div>
                <h2 className="text-base font-semibold leading-snug">
                  {issue.title}
                </h2>
                {issue.dueDate && (
                  <DueDateBadge dueDate={issue.dueDate} />
                )}
                {issue.cycle && (
                  <span className="inline-flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground">
                    <IterationCw className="w-3 h-3" />
                    {issue.cycle.name || `Cycle ${issue.cycle.number}`}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-0.5 shrink-0 ml-2">
                <button
                  type="button"
                  onClick={handleOpenNewWindow}
                  title="Open in new window"
                  aria-label="Open in new window"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  title="Copy task link"
                  aria-label="Copy task link"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  {linkCopied ? (
                    <Check className="w-3.5 h-3.5 text-green-500" />
                  ) : (
                    <Link className="w-3.5 h-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close panel"
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
              {/* Labels — only show if hub has labels configured for this team */}
              {(issue.labels.length > 0 || hubLabels.length > 0) && (
                <LabelEditor
                  issueLabels={issue.labels}
                  hubLabels={hubLabels}
                  hubId={hubId}
                  issueId={issue.id}
                  isViewOnly={isViewOnly}
                  issueStateId={issue.state?.id}
                  workflowLabelIds={workflowLabelIds}
                  workflowRules={workflowRules}
                  onLabelsChange={(labels) => {
                    setIssue((prev) => (prev ? { ...prev, labels } : prev));
                    if (issueId) onIssueUpdate?.(issueId, { labels });
                  }}
                  onStatusChange={(state) => {
                    setIssue((prev) => (prev ? { ...prev, state: { ...prev.state, ...state } } : prev));
                    if (issueId) onIssueUpdate?.(issueId, { state });
                  }}
                />
              )}

              {/* Description */}
              {issue.description && (
                <div className="px-4 py-4 border-b border-border">
                  <div
                    ref={descRef}
                    className={cn(
                      "relative overflow-hidden",
                      !descExpanded && descOverflows && "max-h-[300px]"
                    )}
                  >
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-sm prose-headings:font-semibold prose-p:text-[13px] prose-p:leading-relaxed prose-code:text-xs prose-pre:text-xs">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                        {issue.description}
                      </ReactMarkdown>
                    </div>
                    {!descExpanded && descOverflows && (
                      <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent" />
                    )}
                  </div>
                  {descOverflows && (
                    <button
                      onClick={() => setDescExpanded(!descExpanded)}
                      className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {descExpanded ? (
                        <>
                          <ChevronUp className="w-3 h-3" /> Show less
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3 h-3" /> Show more
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}

              {/* Comments — expanded by default */}
              <CollapsibleComments
                comments={comments}
                hubId={hubId}
                isViewOnly={isViewOnly ?? false}
                mdComponents={mdComponents}
                onReply={(parentId, authorName) => setReplyingTo({ parentId, authorName })}
                onRetrySuccess={(commentId, linearCommentId) => {
                  setComments((prev) => {
                    const update = (c: Comment): Comment => ({
                      ...c,
                      push_status: c.id === commentId ? "pushed" : c.push_status,
                      push_error: c.id === commentId ? undefined : c.push_error,
                      linearId: c.id === commentId ? linearCommentId : c.linearId,
                      children: c.children?.map(update),
                    });
                    return prev.map(update);
                  });
                }}
              />

              {/* History — collapsed by default */}
              {history.length > 0 && (
                <CollapsibleHistory history={history} />
              )}
            </div>

            {/* Comment composer — hidden for view_only users, blocked for unconnected admins */}
            {!isViewOnly && issue && (
              adminLinearBlocked ? (
                <AdminLinearConnectBanner context="comment" />
              ) : (
                <CommentComposer
                  hubId={hubId}
                  issueLinearId={issue.id}
                  replyingTo={replyingTo}
                  onCancelReply={() => setReplyingTo(null)}
                  onCommentAdded={(comment) => {
                    if (comment.parentId) {
                      // Insert reply under its parent thread
                      setComments((prev) =>
                        prev.map((c) =>
                          c.linearId === comment.parentId || c.id === comment.parentId
                            ? { ...c, children: [...(c.children ?? []), comment] }
                            : c
                        )
                      );
                    } else {
                      setComments((prev) => [...prev, comment]);
                    }
                  }}
                />
              )
            )}
          </>
        ) : null}
      </div>

      {/* Image lightbox */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </>
  );
}

// -- Sub-components ──────────────────────────────────────────────────────────

export function StatusBadge({
  state,
}: {
  state: { name: string; color: string; type: string };
}) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px]">
      <StatusIcon type={state.type} color={state.color} size={12} />
      {state.name}
    </span>
  );
}

function StatusIcon({
  type,
  color,
  size = 14,
}: {
  type: string;
  color: string;
  size?: number;
}) {
  const style = { color: color || "var(--muted-foreground)" };
  const s = { width: size, height: size };

  switch (type) {
    case "triage":
    case "backlog":
      return <CircleDashed style={{ ...style, ...s }} />;
    case "unstarted":
      return <Circle style={{ ...style, ...s }} />;
    case "started":
      return <CircleDot style={{ ...style, ...s }} />;
    case "completed":
      return <CircleCheck style={{ ...style, ...s }} />;
    case "cancelled":
      return <CircleX style={{ ...style, ...s }} />;
    default:
      return <Circle style={{ ...style, ...s }} />;
  }
}

export function PriorityIcon({ priority }: { priority: number }) {
  const cls = "w-3.5 h-3.5";
  switch (priority) {
    case 1:
      return <AlertTriangle className={cn(cls, "text-orange-500")} />;
    case 2:
      return <SignalHigh className={cn(cls, "text-orange-400")} />;
    case 3:
      return <SignalMedium className={cn(cls, "text-yellow-500")} />;
    case 4:
      return <SignalLow className={cn(cls, "text-blue-400")} />;
    default:
      return null;
  }
}

export function DueDateBadge({ dueDate }: { dueDate: string }) {
  const date = new Date(dueDate);
  const now = new Date();
  const isOverdue = date < now;
  const isDueSoon =
    !isOverdue && date.getTime() - now.getTime() < 3 * 24 * 60 * 60 * 1000;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 mt-1.5 text-[11px]",
        isOverdue
          ? "text-destructive"
          : isDueSoon
            ? "text-yellow-500"
            : "text-muted-foreground"
      )}
    >
      <Calendar className="w-3 h-3" />
      {isOverdue ? "Overdue: " : "Due: "}
      {date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year:
          date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
      })}
    </span>
  );
}

export function CommentThread({
  comment,
  onReply,
  hubId,
  mdComponents,
  onRetrySuccess,
}: {
  comment: Comment;
  onReply?: (parentId: string, authorName: string) => void;
  hubId: string;
  mdComponents: Components;
  onRetrySuccess?: (commentId: string, linearCommentId: string) => void;
}) {
  const replies = comment.children ?? [];
  // If this comment is itself a reply (orphaned into root), reply to its real parent.
  // Linear only allows parentId to reference root-level comments.
  const parentLinearId = comment.parentId ?? comment.linearId ?? comment.id;
  return (
    <div>
      <CommentBubble
        comment={comment}
        onReply={onReply ? () => onReply(parentLinearId, comment.user.name) : undefined}
        hubId={hubId}
        mdComponents={mdComponents}
        onRetrySuccess={onRetrySuccess}
      />
      {replies.length > 0 && (
        <div className="ml-4 mt-1 border-l-2 border-border pl-3 space-y-1">
          {replies.map((reply) => (
            <CommentBubble key={reply.id} comment={reply} compact hubId={hubId} mdComponents={mdComponents} onRetrySuccess={onRetrySuccess} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CommentBubble({
  comment,
  compact,
  onReply,
  hubId,
  mdComponents,
  onRetrySuccess,
}: {
  comment: Comment;
  compact?: boolean;
  onReply?: () => void;
  hubId: string;
  mdComponents: Components;
  onRetrySuccess?: (commentId: string, linearCommentId: string) => void;
}) {
  const isHub = comment.isHubComment;
  const isTeam = comment.isTeamComment;
  const isFailed = comment.push_status === "failed";
  const isPending = comment.push_status === "pending";
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/hub/${hubId}/comments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commentId: comment.id }),
      });
      if (res.ok) {
        const data = (await res.json()) as { linear_comment_id: string };
        onRetrySuccess?.(comment.id, data.linear_comment_id);
      }
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg",
        compact ? "py-1.5" : "p-3",
        !compact && (isHub ? "bg-accent/50 border border-border" : "bg-muted/50"),
        isFailed && !compact && "border-destructive/30"
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-medium">
          {comment.user.name}
        </span>
        {isTeam && !isHub && (
          <span className="text-[9px] font-medium px-1 py-0 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
            Team
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">
          <RelativeTime dateStr={comment.createdAt} />
        </span>
        {isPending && (
          <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
        )}
        {retrying && (
          <Loader2 className="w-3 h-3 text-muted-foreground animate-spin" />
        )}
        {isFailed && !retrying && (
          <>
            <span className="flex items-center gap-0.5 text-[10px] text-destructive" title={comment.push_error ?? "Failed to sync to Linear"}>
              <AlertCircle className="w-3 h-3" />
              Not synced
            </span>
            <button
              onClick={handleRetry}
              className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              title="Retry syncing to Linear"
            >
              <RotateCcw className="w-3 h-3" />
              Retry
            </button>
          </>
        )}
      </div>
      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:text-[13px] prose-p:leading-relaxed prose-p:my-1">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
          {comment.body}
        </ReactMarkdown>
      </div>
      {onReply && (
        <button
          onClick={onReply}
          className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <Reply className="w-3 h-3" />
          Reply
        </button>
      )}
    </div>
  );
}

const PRIORITY_LABELS: Record<number, string> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

function CollapsibleComments({
  comments,
  hubId,
  isViewOnly,
  mdComponents,
  onReply,
  onRetrySuccess,
}: {
  comments: Comment[];
  hubId: string;
  isViewOnly: boolean;
  mdComponents: Components;
  onReply: (parentId: string, authorName: string) => void;
  onRetrySuccess: (commentId: string, linearCommentId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const count = comments.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-accent/50 transition-colors"
      >
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform",
            expanded && "rotate-90"
          )}
        />
        <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold">Comments</span>
        {count > 0 && (
          <span className="text-[10px] text-muted-foreground">
            ({count})
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          {comments.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No comments yet
            </p>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => (
                <CommentThread
                  key={comment.id}
                  comment={comment}
                  hubId={hubId}
                  mdComponents={mdComponents}
                  onReply={isViewOnly ? undefined : (parentId, authorName) => onReply(parentId, authorName)}
                  onRetrySuccess={onRetrySuccess}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsibleHistory({ history }: { history: HistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-3 text-left hover:bg-accent/50 transition-colors"
      >
        <ChevronRight
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform",
            expanded && "rotate-90"
          )}
        />
        <History className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold">Activity</span>
        <span className="text-[10px] text-muted-foreground">
          ({history.length})
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-0">
          {history.map((entry) => (
            <HistoryItem key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

export function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const isWorkflow = entry.type === "workflow";

  return (
    <div className="flex items-start gap-3 py-2 group">
      {/* Timeline dot / icon */}
      <div className="flex flex-col items-center pt-0.5 shrink-0">
        {isWorkflow ? (
          <Zap className="w-3 h-3 text-amber-500" />
        ) : (
          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {entry.type === "workflow" && (
          <WorkflowHistoryContent entry={entry} />
        )}

        {entry.type === "state" && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
            <span>Status changed</span>
            {entry.fromState && (
              <>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-foreground">
                  <StatusIcon
                    type={entry.fromState.type}
                    color={entry.fromState.color}
                    size={10}
                  />
                  {entry.fromState.name}
                </span>
                <ArrowRight className="w-3 h-3 text-muted-foreground/60" />
              </>
            )}
            {entry.toState && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-foreground">
                <StatusIcon
                  type={entry.toState.type}
                  color={entry.toState.color}
                  size={10}
                />
                {entry.toState.name}
              </span>
            )}
          </div>
        )}

        {entry.type === "priority" && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
            <span>Priority changed</span>
            {entry.fromPriority != null && (
              <>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-foreground">
                  <PriorityIcon priority={entry.fromPriority} />
                  {PRIORITY_LABELS[entry.fromPriority] ?? `P${entry.fromPriority}`}
                </span>
                <ArrowRight className="w-3 h-3 text-muted-foreground/60" />
              </>
            )}
            {entry.toPriority != null && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-foreground">
                <PriorityIcon priority={entry.toPriority} />
                {PRIORITY_LABELS[entry.toPriority] ?? `P${entry.toPriority}`}
              </span>
            )}
          </div>
        )}

        {entry.type === "label" && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
            <Tag className="w-3 h-3" />
            {entry.addedLabels?.map((label) => (
              <span key={label.name} className="inline-flex items-center gap-1">
                <span>Added</span>
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-foreground"
                  style={{ backgroundColor: `${label.color}20` }}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </span>
              </span>
            ))}
            {entry.removedLabels?.map((label) => (
              <span key={label.name} className="inline-flex items-center gap-1">
                <span>Removed</span>
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-foreground line-through opacity-60"
                  style={{ backgroundColor: `${label.color}20` }}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </span>
              </span>
            ))}
          </div>
        )}

        <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">
          <RelativeTime dateStr={entry.createdAt} />
        </span>
      </div>
    </div>
  );
}

function WorkflowHistoryContent({ entry }: { entry: HistoryEntry }) {
  const actionConfig = entry.workflowActionConfig ?? {};
  const stateName = (actionConfig.stateName as string) ?? (actionConfig.stateId as string) ?? "unknown";
  const isFailed = entry.workflowResult === "failure";

  if (entry.workflowActionType === "set_status") {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1 py-0 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <Zap className="w-2.5 h-2.5" />
            Automation
          </span>
          <span>Status set to</span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-[10px] text-foreground">
            {stateName}
          </span>
          {isFailed && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-destructive">
              <AlertCircle className="w-3 h-3" />
              Failed
            </span>
          )}
        </div>
        {isFailed && entry.workflowError && (
          <span className="text-[10px] text-destructive/70 truncate">
            {entry.workflowError}
          </span>
        )}
      </div>
    );
  }

  // Fallback for unknown action types
  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1 py-0 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Zap className="w-2.5 h-2.5" />
        Automation
      </span>
      <span>{entry.workflowActionType}</span>
      {isFailed && (
        <span className="inline-flex items-center gap-0.5 text-[10px] text-destructive">
          <AlertCircle className="w-3 h-3" />
          Failed
        </span>
      )}
    </div>
  );
}

export function RelativeTime({ dateStr }: { dateStr: string }) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return <>just now</>;
  if (diffMin < 60) return <>{diffMin}m ago</>;
  if (diffHr < 24) return <>{diffHr}h ago</>;
  if (diffDay < 30) return <>{diffDay}d ago</>;
  return (
    <>
      {date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}
    </>
  );
}
