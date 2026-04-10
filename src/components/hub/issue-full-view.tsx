"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { captureEvent } from "@/lib/posthog-client";
import { POSTHOG_EVENTS } from "@/lib/posthog-events";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CommentComposer } from "./comment-composer";
import { AdminLinearConnectBanner } from "./admin-linear-connect-banner";
import { LabelEditor } from "./label-editor";
import { ImageLightbox } from "./image-lightbox";
import { useAdminLinearGate } from "@/hooks/use-admin-linear-gate";
import {
  MessageSquare,
  Loader2,
  History,
  IterationCw,
  Link,
  Check,
} from "lucide-react";
import {
  type IssueDetail,
  type Comment,
  type HistoryEntry,
  StatusBadge,
  PriorityIcon,
  DueDateBadge,
  CommentThread,
  HistoryItem,
  useMarkdownComponents,
} from "./issue-detail-panel";
import { useHub } from "@/contexts/hub-context";

export function IssueFullView({
  issueId,
  hubId,
}: {
  issueId: string;
  hubId: string;
}) {
  const { isViewOnly } = useHub();
  const { blocked: adminLinearBlocked } = useAdminLinearGate();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [hubLabels, setHubLabels] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [workflowLabelIds, setWorkflowLabelIds] = useState<string[]>([]);
  const [workflowRules, setWorkflowRules] = useState<Array<{ labelId: string; triggerType: string; description: string }>>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<{ parentId: string; authorName: string } | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt?: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mdComponents = useMarkdownComponents((src, alt) => setLightboxImage({ src, alt }));

  // Fetch issue data
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setIssue(null);
    setComments([]);
    setHistory([]);
    setHubLabels([]);
    setWorkflowLabelIds([]);
    setWorkflowRules([]);

    async function fetchIssue() {
      try {
        const [issueResult, historyResult] = await Promise.allSettled([
          fetch(`/api/hub/${hubId}/issues/${issueId}`),
          fetch(`/api/hub/${hubId}/issues/${issueId}/history`),
        ]);

        if (!cancelled && issueResult.status === "fulfilled" && issueResult.value.ok) {
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
        }

        if (!cancelled && historyResult.status === "fulfilled" && historyResult.value.ok) {
          const historyData = (await historyResult.value.json()) as { history: HistoryEntry[] };
          setHistory(historyData.history ?? []);
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchIssue();
    return () => { cancelled = true; };
  }, [issueId, hubId]);

  // Track issue view
  useEffect(() => {
    if (issue) {
      captureEvent(POSTHOG_EVENTS.issue_viewed, { issueId: issue.identifier || issue.id });
    }
  }, [issue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      // clipboard API unavailable
    }
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleRetrySuccess = useCallback((commentId: string, linearCommentId: string) => {
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
  }, []);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Task not found</p>
      </div>
    );
  }

  const commentCount = comments.reduce((n, c) => n + 1 + (c.children?.length ?? 0), 0);

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-6 py-4 space-y-6">
          {/* Header */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-mono text-muted-foreground">
                {issue.identifier}
              </span>
              <StatusBadge state={issue.state} />
              <PriorityIcon priority={issue.priority} />
              <button
                type="button"
                onClick={handleCopyLink}
                title="Copy task link"
                aria-label="Copy task link"
                className="ml-auto p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                {linkCopied ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Link className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            <h1 className="text-xl font-semibold leading-snug">{issue.title}</h1>
            <div className="flex items-center gap-3 mt-2">
              {issue.dueDate && <DueDateBadge dueDate={issue.dueDate} />}
              {issue.cycle && (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <IterationCw className="w-3 h-3" />
                  {issue.cycle.name || `Cycle ${issue.cycle.number}`}
                </span>
              )}
            </div>
          </div>

          {/* Labels */}
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
              }}
              onStatusChange={(state) => {
                setIssue((prev) => (prev ? { ...prev, state: { ...prev.state, ...state } } : prev));
              }}
            />
          )}

          {/* Description — always fully expanded */}
          {issue.description && (
            <div className="border-b border-border pb-6">
              <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-sm prose-headings:font-semibold prose-p:text-[13px] prose-p:leading-relaxed prose-code:text-xs prose-pre:text-xs">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {issue.description}
                </ReactMarkdown>
              </div>
            </div>
          )}

          {/* Comments — always expanded */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-semibold">Comments</span>
              {commentCount > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  ({commentCount})
                </span>
              )}
            </div>
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
                    onReply={isViewOnly ? undefined : (parentId, authorName) => setReplyingTo({ parentId, authorName })}
                    onRetrySuccess={handleRetrySuccess}
                  />
                ))}
              </div>
            )}
          </div>

          {/* History — always expanded */}
          {history.length > 0 && (
            <div className="border-t border-border pt-4">
              <div className="flex items-center gap-2 mb-3">
                <History className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold">Activity</span>
                <span className="text-[10px] text-muted-foreground">
                  ({history.length})
                </span>
              </div>
              <div className="space-y-0">
                {history.map((entry) => (
                  <HistoryItem key={entry.id} entry={entry} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Comment composer — sticky at bottom */}
      {!isViewOnly && (
        <div className="max-w-2xl mx-auto w-full px-6">
          {adminLinearBlocked ? (
            <AdminLinearConnectBanner context="comment" />
          ) : (
            <CommentComposer
              hubId={hubId}
              issueLinearId={issue.id}
              replyingTo={replyingTo}
              onCancelReply={() => setReplyingTo(null)}
              onCommentAdded={(comment) => {
                if (comment.parentId) {
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
          )}
        </div>
      )}

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
