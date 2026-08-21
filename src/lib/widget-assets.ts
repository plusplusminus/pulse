/**
 * Attachment assets for a widget submission (PULSE-403).
 *
 * `widget_submission_assets` holds one row per attached artefact. Until the
 * legacy one-column-per-kind fields on `widget_submissions` are dropped in a
 * later migration, every reader is DUAL-READ: it prefers asset rows and falls
 * back, per kind, to the legacy column. `resolveSubmissionAssets` is that rule
 * in one place — the proxy, the admin detail view and the Linear renderer all
 * go through it so they cannot drift apart.
 *
 * Pure decision module: no Supabase, no Storage, no fetch. The callers own I/O.
 */

import type { ScreenshotAnnotation, WidgetSubmission } from "@/lib/widget-types";
import {
  WIDGET_MEDIA_CONTENT_TYPES,
  WIDGET_MEDIA_MAX_BYTES,
  type WidgetMediaKind,
} from "@/lib/widget-upload";

/**
 * How many of each kind one submission may carry. The feedback endpoint is
 * public — the site key ships in the page and Origin is spoofable outside a
 * browser — so the widget's own limit is a hint, not a cap; this is enforced
 * server-side in /api/widget/feedback.
 */
export const WIDGET_ASSET_CAPS = {
  screenshot: 6,
  video: 1,
  replay: 1,
} as const satisfies Record<WidgetMediaKind, number>;

/** Total across all kinds; bounds the array before per-kind counting. */
export const MAX_ASSETS_PER_SUBMISSION = Object.values(
  WIDGET_ASSET_CAPS
).reduce((sum, n) => sum + n, 0);

/** Render order when a submission's assets are listed as a whole. */
const KIND_ORDER: Record<WidgetMediaKind, number> = {
  screenshot: 0,
  video: 1,
  replay: 2,
};

/** A `widget_submission_assets` row, as selected by the server. */
export type WidgetSubmissionAsset = {
  id: string;
  submission_id: string;
  kind: WidgetMediaKind;
  storage_path: string;
  content_type: string;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  annotations: ScreenshotAnnotation[] | null;
  position: number;
  purged_at: string | null;
  created_at: string;
};

/**
 * One attachment as readers see it, whether it came from an asset row or from a
 * legacy column. `id` is null exactly when it was synthesised from a column: a
 * caller that needs `/api/widget/media/asset/:assetId` must fall back to the
 * `:submissionId/:kind` URL for those.
 */
export type ResolvedAsset = {
  id: string | null;
  kind: WidgetMediaKind;
  storagePath: string;
  contentType: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  annotations: ScreenshotAnnotation[];
  position: number;
  purgedAt: string | null;
};

/** The legacy fields `resolveSubmissionAssets` falls back to. */
export type LegacySubmissionMedia = Pick<
  WidgetSubmission,
  | "screenshot_storage_path"
  | "video_storage_path"
  | "replay_storage_path"
  | "media_purged_at"
> &
  Partial<Pick<WidgetSubmission, "screenshot_annotations">>;

const LEGACY_COLUMNS = {
  screenshot: "screenshot_storage_path",
  video: "video_storage_path",
  replay: "replay_storage_path",
} as const satisfies Record<WidgetMediaKind, keyof LegacySubmissionMedia>;

const KINDS = Object.keys(KIND_ORDER) as WidgetMediaKind[];

/**
 * Content type implied by the extension the upload signer minted. Used to fill
 * in a legacy column that predates `widget_submission_assets.content_type`, and
 * mirrors the SQL backfill in 20260821_widget_submission_assets.sql.
 */
export function contentTypeForStoragePath(
  storagePath: string,
  kind: WidgetMediaKind
): string | null {
  const ext = storagePath.slice(storagePath.lastIndexOf(".") + 1).toLowerCase();
  for (const [type, mapped] of Object.entries(
    WIDGET_MEDIA_CONTENT_TYPES[kind]
  )) {
    if (mapped === ext) return type;
  }
  // The signer writes .jpg for image/jpeg; a hand-written .jpeg still resolves.
  if (kind === "screenshot" && ext === "jpeg") return "image/jpeg";
  return null;
}

function fromRow(row: WidgetSubmissionAsset): ResolvedAsset {
  return {
    id: row.id,
    kind: row.kind,
    storagePath: row.storage_path,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    annotations: row.annotations ?? [],
    position: row.position,
    purgedAt: row.purged_at,
  };
}

function fromLegacyColumn(
  submission: LegacySubmissionMedia,
  kind: WidgetMediaKind
): ResolvedAsset | null {
  const storagePath = submission[LEGACY_COLUMNS[kind]];
  if (!storagePath) return null;
  return {
    id: null,
    kind,
    storagePath,
    contentType: contentTypeForStoragePath(storagePath, kind),
    sizeBytes: null,
    width: null,
    height: null,
    durationMs: null,
    // Pre-PULSE-403 annotations sit on the submission and describe the one
    // screenshot it could carry.
    annotations:
      kind === "screenshot" ? (submission.screenshot_annotations ?? []) : [],
    position: 0,
    purgedAt: null,
  };
}

function compare(a: ResolvedAsset, b: ResolvedAsset): number {
  if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (a.position !== b.position) return a.position - b.position;
  // Stable tiebreak so two assets sharing a position never reorder between
  // requests — which would change which one the legacy proxy URL resolves to.
  return (a.id ?? "").localeCompare(b.id ?? "");
}

export type ResolveSubmissionAssetsInput = {
  /** Rows from `widget_submission_assets`, in any order. */
  assets?: readonly WidgetSubmissionAsset[] | null;
  /** The submission's legacy columns, used per kind when no row exists. */
  submission: LegacySubmissionMedia;
};

/**
 * Every attachment on a submission, ordered. The fallback is per kind, not
 * all-or-nothing: a row backfilled for its screenshot but not its video still
 * yields both. Purged assets are included with `purgedAt` set — the proxy needs
 * them to answer 410 rather than 404.
 */
export function resolveSubmissionAssets(
  input: ResolveSubmissionAssetsInput
): ResolvedAsset[] {
  const rows = input.assets ?? [];
  const resolved: ResolvedAsset[] = [];

  for (const kind of KINDS) {
    const ofKind = rows.filter((row) => row.kind === kind);
    if (ofKind.length > 0) {
      resolved.push(...ofKind.map(fromRow));
      continue;
    }
    const legacy = fromLegacyColumn(input.submission, kind);
    if (legacy) resolved.push(legacy);
  }

  return resolved.sort(compare);
}

/** Every asset of one kind, in position order. */
export function assetsOfKind(
  assets: readonly ResolvedAsset[],
  kind: WidgetMediaKind
): ResolvedAsset[] {
  return assets.filter((asset) => asset.kind === kind).sort(compare);
}

/**
 * The asset a legacy `/api/widget/media/:submissionId/:kind` URL resolves to:
 * lowest `position` of that kind, purged or not. Returning the purged one is
 * deliberate — it is what lets the proxy answer 410 instead of 404.
 */
export function firstAssetOfKind(
  assets: readonly ResolvedAsset[],
  kind: WidgetMediaKind
): ResolvedAsset | null {
  return assetsOfKind(assets, kind)[0] ?? null;
}

// -- Cap enforcement -------------------------------------------------------

export type AssetCapViolation = {
  kind: WidgetMediaKind;
  cap: number;
  count: number;
};

/** Count per kind, with kinds absent from the input reported as 0. */
export function countByKind(
  assets: readonly { kind: WidgetMediaKind }[]
): Record<WidgetMediaKind, number> {
  const counts = { screenshot: 0, video: 0, replay: 0 };
  for (const asset of assets) counts[asset.kind]++;
  return counts;
}

/**
 * The first cap a submission's attachments break, or null. Checked in
 * KIND_ORDER so the message is deterministic for a payload breaking two.
 */
export function findAssetCapViolation(
  assets: readonly { kind: WidgetMediaKind }[]
): AssetCapViolation | null {
  const counts = countByKind(assets);
  for (const kind of KINDS) {
    const cap = WIDGET_ASSET_CAPS[kind];
    if (counts[kind] > cap) {
      return { kind, cap, count: counts[kind] };
    }
  }
  return null;
}

/** Human-readable rejection for a broken cap, returned to the widget. */
export function assetCapMessage(violation: AssetCapViolation): string {
  return `Too many ${violation.kind} attachments: ${violation.count} submitted, ${violation.cap} allowed per submission`;
}

/** Per-kind byte ceiling, unchanged from the upload signer (PULSE-322). */
export function exceedsSizeCap(
  kind: WidgetMediaKind,
  sizeBytes: number | null | undefined
): boolean {
  if (sizeBytes === null || sizeBytes === undefined) return false;
  return sizeBytes > WIDGET_MEDIA_MAX_BYTES[kind];
}
