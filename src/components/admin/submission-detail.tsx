"use client";

/**
 * PULSE-347 — one widget submission with every artefact inline.
 *
 * Media is addressed through the Pulse media proxy (PULSE-324); the page payload
 * never carries a signed URL. Retention (PULSE-317) nulls storage paths and
 * stamps `media_purged_at`, so "purged" is rendered as its own state rather than
 * being confused with "never attached".
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Film,
  MousePointerClick,
  PlayCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { AnnotationOverlay } from "./annotation-overlay";
import { cn } from "@/lib/utils";
import {
  mediaProxyUrl,
  screenshotSrc,
  submissionArtefacts,
  type ArtefactState,
} from "@/lib/widget-artefacts";
import type {
  PickIntent,
  ScreenshotAnnotation,
  WidgetPick,
  WidgetSubmission,
} from "@/lib/widget-types";
import { retrySubmissionSync } from "@/lib/widget-retry-sync";
import { ReplayPlayerFromUrl } from "./replay-player";

const TYPE_BADGE: Record<string, string> = {
  bug: "bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]",
  feedback: "bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]",
  idea: "bg-[var(--badge-purple-bg)] text-[var(--badge-purple-text)]",
};

const STATUS_BADGE: Record<string, string> = {
  synced: "bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]",
  failed: "bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]",
  pending: "bg-[var(--badge-yellow-bg)] text-[var(--badge-yellow-text)]",
};

const INTENT_BADGE: Record<PickIntent, string> = {
  fix: "bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]",
  change: "bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]",
  question: "bg-[var(--badge-yellow-bg)] text-[var(--badge-yellow-text)]",
  approve: "bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]",
};

export function SubmissionDetail({
  hubId,
  submission,
}: {
  hubId: string;
  submission: WidgetSubmission;
}) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  const artefacts = submissionArtefacts(submission);
  const picks = submission.picks ?? [];
  const annotations = submission.screenshot_annotations ?? [];
  const imageSrc = screenshotSrc(submission);

  const retrySync = async () => {
    setRetrying(true);
    try {
      await retrySubmissionSync(submission.id);
      toast.success("Sync retried");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl">
      <Link
        href={`/admin/hubs/${hubId}/widget/submissions`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        All submissions
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold truncate">
              {submission.title}
            </h1>
            <Badge className={TYPE_BADGE[submission.type]}>
              {capitalise(submission.type)}
            </Badge>
            <Badge
              className={STATUS_BADGE[submission.sync_status]}
              title={submission.sync_error ?? undefined}
            >
              {capitalise(submission.sync_status)}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(submission.created_at).toLocaleString()} ·{" "}
            {submission.reporter_name
              ? `${submission.reporter_name} (${submission.reporter_email})`
              : submission.reporter_email}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {submission.sync_status === "failed" && (
            <button
              type="button"
              onClick={retrySync}
              disabled={retrying}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <RefreshCw
                className={cn("w-3.5 h-3.5", retrying && "animate-spin")}
              />
              Retry sync
            </button>
          )}
          {submission.linear_issue_url && (
            <a
              href={submission.linear_issue_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-accent/50 transition-colors"
            >
              Open in Linear
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      {submission.sync_status === "failed" && submission.sync_error && (
        <p className="mt-3 text-xs text-destructive border border-destructive/30 bg-destructive/5 rounded-md px-3 py-2">
          {submission.sync_error}
        </p>
      )}

      {submission.media_purged_at && (
        <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground border border-border bg-muted/30 rounded-md px-3 py-2">
          <Trash2 className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>
            Media for this submission was removed on{" "}
            {new Date(submission.media_purged_at).toLocaleDateString()} under the
            retention policy. Picks and metadata are kept.
          </span>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        <div className="space-y-6 min-w-0">
          <Section title="Description">
            {submission.description ? (
              <p className="text-sm whitespace-pre-wrap">
                {submission.description}
              </p>
            ) : (
              <Empty>No description provided</Empty>
            )}
          </Section>

          <Section
            title="Element picks"
            icon={<MousePointerClick className="w-3.5 h-3.5" />}
            count={picks.length}
          >
            {picks.length === 0 ? (
              <Empty>No elements were picked</Empty>
            ) : (
              <div className="space-y-2">
                {picks.map((pick, index) => (
                  <PickCard key={pick.id ?? index} pick={pick} index={index} />
                ))}
              </div>
            )}
          </Section>

          <Section
            title="Screenshot"
            icon={<Camera className="w-3.5 h-3.5" />}
            count={annotations.length || undefined}
            countLabel="annotations"
          >
            <ArtefactSlot
              state={artefacts.screenshot}
              absent="No screenshot attached"
              purged="Screenshot removed after the retention period"
            >
              {imageSrc && (
                <ScreenshotPanel src={imageSrc} annotations={annotations} />
              )}
            </ArtefactSlot>
          </Section>

          <Section title="Video" icon={<Film className="w-3.5 h-3.5" />}>
            <ArtefactSlot
              state={artefacts.video}
              absent="No video recording attached"
              purged="Video removed after the retention period"
            >
              <VideoPanel src={mediaProxyUrl(submission.id, "video")} />
            </ArtefactSlot>
          </Section>

          <Section
            title="Session replay"
            icon={<PlayCircle className="w-3.5 h-3.5" />}
          >
            <ArtefactSlot
              state={artefacts.replay}
              absent="No session replay recorded"
              purged="Session replay removed after the retention period"
            >
              <ReplayPlayerFromUrl
                src={mediaProxyUrl(submission.id, "replay")}
              />
            </ArtefactSlot>
          </Section>
        </div>

        <MetadataPanel submission={submission} />
      </div>
    </div>
  );
}

/* -- Artefacts ----------------------------------------------------------- */

function ArtefactSlot({
  state,
  absent,
  purged,
  children,
}: {
  state: ArtefactState;
  absent: string;
  purged: string;
  children: React.ReactNode;
}) {
  if (state === "present") return <>{children}</>;
  if (state === "purged") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-6 text-sm text-muted-foreground justify-center">
        <Trash2 className="w-4 h-4" />
        {purged}
      </div>
    );
  }
  return <Empty>{absent}</Empty>;
}

function ScreenshotPanel({
  src,
  annotations,
}: {
  src: string;
  annotations: ScreenshotAnnotation[];
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-6 text-sm text-muted-foreground justify-center">
        <AlertTriangle className="w-4 h-4" />
        Screenshot could not be loaded
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative w-fit max-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Submission screenshot"
          onLoad={(e) =>
            setNatural({
              w: e.currentTarget.naturalWidth,
              h: e.currentTarget.naturalHeight,
            })
          }
          onError={() => setFailed(true)}
          className="max-w-full h-auto rounded-md border border-border block"
        />
        {showAnnotations && natural && natural.w > 0 && natural.h > 0 && (
          <AnnotationOverlay annotations={annotations} natural={natural} />
        )}
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {annotations.length > 0 && (
          <label className="inline-flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showAnnotations}
              onChange={(e) => setShowAnnotations(e.target.checked)}
              className="accent-primary"
            />
            Show annotations ({annotations.length})
          </label>
        )}
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline ml-auto"
        >
          Open full size
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
}

function VideoPanel({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-6 text-sm text-muted-foreground justify-center">
        <AlertTriangle className="w-4 h-4" />
        Video could not be loaded
      </div>
    );
  }

  return (
    <video
      controls
      preload="metadata"
      src={src}
      onError={() => setFailed(true)}
      className="w-full rounded-md border border-border bg-black"
    />
  );
}

/* -- Picks --------------------------------------------------------------- */

function PickCard({ pick, index }: { pick: WidgetPick; index: number }) {
  const geometry = pick.areaRect ?? pick.boundingBox;

  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-medium text-muted-foreground tabular-nums">
          #{index + 1}
        </span>
        <span className="text-sm font-medium truncate">
          {pick.name || "Unnamed element"}
        </span>
        {pick.intent && (
          <Badge className={INTENT_BADGE[pick.intent]}>
            {capitalise(pick.intent)}
          </Badge>
        )}
        {pick.isArea && <Badge>Area</Badge>}
        {pick.isMultiSelect && <Badge>Multi-select</Badge>}
        {pick.isFixed && <Badge>Fixed position</Badge>}
      </div>

      {pick.comment && (
        <p className="text-sm mt-1.5 whitespace-pre-wrap">{pick.comment}</p>
      )}

      {pick.selector && (
        <p className="mt-1.5">
          <Code>{pick.selector}</Code>
        </p>
      )}

      {pick.nearbyText && (
        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
          &ldquo;{pick.nearbyText}&rdquo;
        </p>
      )}

      <Disclosure label="Technical detail">
        <Field label="Element path">
          <Code>{pick.elementPath}</Code>
        </Field>
        {pick.fullPath && (
          <Field label="Full path">
            <Code>{pick.fullPath}</Code>
          </Field>
        )}
        {pick.xpath && (
          <Field label="XPath">
            <Code>{pick.xpath}</Code>
          </Field>
        )}
        {pick.classes && (
          <Field label="Classes">
            <Code>{pick.classes}</Code>
          </Field>
        )}
        {geometry && (
          <Field label="Bounding box">
            <span className="text-xs tabular-nums">
              {Math.round(geometry.width)} × {Math.round(geometry.height)} at{" "}
              {Math.round(geometry.x)}, {Math.round(geometry.y)}
            </span>
          </Field>
        )}
        {pick.selectedText && (
          <Field label="Selected text">
            <span className="text-xs">{pick.selectedText}</span>
          </Field>
        )}
        {pick.accessibility && (
          <Field label="Accessibility">
            <span className="text-xs">{pick.accessibility}</span>
          </Field>
        )}
        {pick.computedStyles && Object.keys(pick.computedStyles).length > 0 && (
          <Field label="Computed styles">
            <Pre>{formatStyles(pick.computedStyles)}</Pre>
          </Field>
        )}
        {pick.relocation && (
          <Field label="Relocation">
            <span className="text-xs tabular-nums">
              viewport {pick.relocation.viewport.width}×
              {pick.relocation.viewport.height} · scroll{" "}
              {Math.round(pick.relocation.scrollX)},{" "}
              {Math.round(pick.relocation.scrollY)} · dpr {pick.relocation.dpr}
            </span>
          </Field>
        )}
      </Disclosure>
    </div>
  );
}

function formatStyles(styles: Record<string, string>) {
  return Object.entries(styles)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

/* -- Metadata side panel ------------------------------------------------- */

function MetadataPanel({ submission }: { submission: WidgetSubmission }) {
  const [open, setOpen] = useState(true);
  const metadata = submission.metadata;
  const console_ = metadata?.console ?? [];
  const sentry = metadata?.sentry;
  const custom = metadata?.custom ?? {};
  const pageUrl = submission.page_url ?? metadata?.url ?? null;

  return (
    <aside className="border border-border rounded-lg bg-card overflow-hidden lg:sticky lg:top-6">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-3 py-2.5 text-left hover:bg-accent/30 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">Details</span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-border">
          <Group title="Page">
            <Field label="Submitted from">
              {pageUrl ? (
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline break-all"
                >
                  {pageUrl}
                </a>
              ) : (
                <Muted>Unknown</Muted>
              )}
            </Field>
            <Field label="Viewport">
              {metadata?.viewport ? (
                <span className="text-xs tabular-nums">
                  {metadata.viewport.width} × {metadata.viewport.height}
                </span>
              ) : (
                <Muted>Unknown</Muted>
              )}
            </Field>
            {metadata?.captureSurface && (
              <Field label="Capture surface">
                <span className="text-xs">{metadata.captureSurface}</span>
              </Field>
            )}
            <Field label="Captured at">
              <span className="text-xs">
                {metadata?.timestamp
                  ? new Date(metadata.timestamp).toLocaleString()
                  : new Date(submission.created_at).toLocaleString()}
              </span>
            </Field>
            <Field label="User agent">
              <span className="text-xs text-muted-foreground break-all">
                {metadata?.userAgent ?? "Unknown"}
              </span>
            </Field>
          </Group>

          <Group title="Reporter">
            <Field label="Email">
              <span className="text-xs break-all">
                {submission.reporter_email}
              </span>
            </Field>
            {submission.reporter_name && (
              <Field label="Name">
                <span className="text-xs">{submission.reporter_name}</span>
              </Field>
            )}
          </Group>

          <Group title={`Console (${console_.length})`}>
            {console_.length === 0 ? (
              <Muted>No console output captured</Muted>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-border rounded-md bg-muted/30">
                {console_.map((entry, index) => (
                  <div
                    key={index}
                    className={cn(
                      "px-2 py-1 text-[11px] font-mono break-all",
                      index > 0 && "border-t border-border/50",
                      entry.level === "error" &&
                        "text-[var(--badge-red-text)]",
                      entry.level === "warn" &&
                        "text-[var(--badge-yellow-text)]"
                    )}
                  >
                    <span className="text-muted-foreground mr-1.5">
                      [{entry.level}]
                    </span>
                    {entry.message}
                  </div>
                ))}
              </div>
            )}
          </Group>

          <Group title="Sentry">
            {sentry ? (
              <>
                {sentry.replayUrl && (
                  <Field label="Replay">
                    <a
                      href={sentry.replayUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      Open in Sentry
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </Field>
                )}
                {sentry.replayId && (
                  <Field label="Replay ID">
                    <Code>{sentry.replayId}</Code>
                  </Field>
                )}
                {sentry.sessionId && (
                  <Field label="Session ID">
                    <Code>{sentry.sessionId}</Code>
                  </Field>
                )}
                {sentry.traceId && (
                  <Field label="Trace ID">
                    <Code>{sentry.traceId}</Code>
                  </Field>
                )}
              </>
            ) : (
              <Muted>Not linked to Sentry</Muted>
            )}
          </Group>

          {Object.keys(custom).length > 0 && (
            <Group title="Custom">
              {Object.entries(custom).map(([key, value]) => (
                <Field key={key} label={key}>
                  <span className="text-xs break-all">{value}</span>
                </Field>
              ))}
            </Group>
          )}
        </div>
      )}
    </aside>
  );
}

/* -- Primitives ---------------------------------------------------------- */

function Section({
  title,
  icon,
  count,
  countLabel,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  count?: number;
  countLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
        {icon}
        <h2 className="text-xs font-medium uppercase tracking-wide">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="text-[10px] text-muted-foreground">
            {count}
            {countLabel ? ` ${countLabel}` : ""}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 items-start">
      <span className="text-[11px] text-muted-foreground truncate">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Disclosure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group mt-2">
      <summary className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer list-none transition-colors">
        <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
        {label}
      </summary>
      <div className="mt-1.5 space-y-1.5 pl-4">{children}</div>
    </details>
  );
}

function Badge({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium w-fit shrink-0",
        className ??
          "bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)]"
      )}
    >
      {children}
    </span>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="text-[11px] font-mono bg-muted/60 border border-border rounded px-1 py-0.5 break-all">
      {children}
    </code>
  );
}

function Pre({ children }: { children: React.ReactNode }) {
  return (
    <pre className="text-[11px] font-mono bg-muted/40 border border-border rounded-md p-2 overflow-x-auto max-h-40 overflow-y-auto">
      {children}
    </pre>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground rounded-md border border-dashed border-border px-3 py-4 text-center">
      {children}
    </p>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-muted-foreground">{children}</span>;
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
