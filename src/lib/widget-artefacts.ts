/**
 * PULSE-347/348 — which artefacts a widget submission carries, and where the
 * admin UI should point to fetch them.
 *
 * Media is always addressed through the Pulse media proxy
 * (`GET /api/widget/media/:submissionId/:kind`, PULSE-324): it authorises the
 * viewer and 302s to a short-lived signed Supabase Storage URL. Signed URLs are
 * never minted here and never reach the page payload.
 *
 * Retention (PULSE-317) nulls the storage paths and stamps `media_purged_at`,
 * which is the only way to tell "we deleted it" from "it never had one" — hence
 * three states rather than a boolean.
 */

import { assetsOfKind, type ResolvedAsset } from "@/lib/widget-assets";
import type { WidgetMediaKind } from "@/lib/widget-upload";
import type { ScreenshotAnnotation, WidgetSubmission } from "@/lib/widget-types";

export type ArtefactState = "present" | "purged" | "absent";

export function artefactState(
  storagePath: string | null | undefined,
  mediaPurgedAt: string | null | undefined
): ArtefactState {
  if (storagePath) return "present";
  return mediaPurgedAt ? "purged" : "absent";
}

export function mediaProxyUrl(
  submissionId: string,
  kind: WidgetMediaKind
): string {
  return `/api/widget/media/${submissionId}/${kind}`;
}

/**
 * Relative proxy URL for one specific attachment (PULSE-403). Use this whenever
 * an asset has an id; `mediaProxyUrl` only ever reaches the first of its kind,
 * and is the fallback for an attachment still living in a legacy column.
 */
export function mediaAssetProxyUrl(assetId: string): string {
  return `/api/widget/media/asset/${assetId}`;
}

/**
 * Screenshots predate the storage-path migration: rows created before PULSE-324
 * carry a directly usable `screenshot_url` and no path. Prefer the proxy when
 * there is a path, fall back to the stored URL, otherwise there is nothing to
 * show.
 */
export function screenshotSrc(
  submission: Pick<
    WidgetSubmission,
    "id" | "screenshot_storage_path" | "screenshot_url"
  >
): string | null {
  if (submission.screenshot_storage_path) {
    return mediaProxyUrl(submission.id, "screenshot");
  }
  return submission.screenshot_url ?? null;
}

export type SubmissionArtefacts = {
  screenshot: ArtefactState;
  video: ArtefactState;
  replay: ArtefactState;
  pickCount: number;
  annotationCount: number;
  /** True when the row has at least one artefact worth an icon in the table. */
  hasAny: boolean;
};

type ArtefactSource = Pick<
  WidgetSubmission,
  | "id"
  | "screenshot_url"
  | "screenshot_storage_path"
  | "video_storage_path"
  | "replay_storage_path"
  | "media_purged_at"
> &
  Partial<Pick<WidgetSubmission, "picks" | "screenshot_annotations">>;

export function submissionArtefacts(
  submission: ArtefactSource
): SubmissionArtefacts {
  const purgedAt = submission.media_purged_at;
  const screenshot = artefactState(
    submission.screenshot_storage_path ?? submission.screenshot_url,
    purgedAt
  );
  const video = artefactState(submission.video_storage_path, purgedAt);
  const replay = artefactState(submission.replay_storage_path, purgedAt);
  const pickCount = submission.picks?.length ?? 0;

  return {
    screenshot,
    video,
    replay,
    pickCount,
    annotationCount: submission.screenshot_annotations?.length ?? 0,
    hasAny:
      pickCount > 0 ||
      screenshot !== "absent" ||
      video !== "absent" ||
      replay !== "absent",
  };
}

// -- Screenshot gallery (PULSE-403) ----------------------------------------

/** One image in the detail view's gallery, already resolved to a proxy URL. */
export type SubmissionScreenshot = {
  /** Stable React key: the asset id, or "legacy" for a synthesised one. */
  key: string;
  /** Null exactly when the object has been purged; nothing to fetch. */
  src: string | null;
  annotations: ScreenshotAnnotation[];
  purged: boolean;
};

type ScreenshotGallerySource = Pick<
  WidgetSubmission,
  "id" | "screenshot_url" | "screenshot_storage_path"
> &
  Partial<Pick<WidgetSubmission, "screenshot_annotations">>;

/**
 * Every screenshot on a submission, in position order, each pointing at its own
 * asset URL and carrying its own marks.
 *
 * The `screenshot_url` fallback is the third read path, below asset rows and
 * legacy storage paths: rows created before PULSE-324 carry a directly usable
 * URL and no path at all, and `resolveSubmissionAssets` cannot see those.
 */
export function submissionScreenshots(
  assets: readonly ResolvedAsset[],
  submission: ScreenshotGallerySource
): SubmissionScreenshot[] {
  const screenshots = assetsOfKind(assets, "screenshot");

  if (screenshots.length === 0) {
    const legacy = screenshotSrc(submission);
    if (!legacy) return [];
    return [
      {
        key: "legacy",
        src: legacy,
        annotations: submission.screenshot_annotations ?? [],
        purged: false,
      },
    ];
  }

  return screenshots.map((asset, index) => ({
    key: asset.id ?? `legacy-${index}`,
    src: asset.purgedAt
      ? null
      : asset.id
        ? mediaAssetProxyUrl(asset.id)
        : screenshotSrc(submission),
    annotations: asset.annotations,
    purged: asset.purgedAt !== null,
  }));
}

/**
 * The Screenshot section's state for a whole gallery: present while any image
 * is still fetchable, purged once every one has been deleted, absent when none
 * was ever attached.
 */
export function galleryState(
  screenshots: readonly SubmissionScreenshot[],
  mediaPurgedAt: string | null | undefined
): ArtefactState {
  if (screenshots.some((shot) => !shot.purged && shot.src)) return "present";
  if (screenshots.length > 0 || mediaPurgedAt) return "purged";
  return "absent";
}
