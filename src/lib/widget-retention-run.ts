import * as Sentry from "@sentry/nextjs";
import { supabaseAdmin } from "@/lib/supabase";
import {
  STORAGE_PATH_PATTERN,
  deleteWidgetObjects,
} from "@/lib/widget-upload";
import {
  MIN_RETENTION_DAYS,
  candidateCutoff,
  planAssetRetentionDeletes,
  planRetentionDeletes,
  retentionPatch,
  type RetentionAsset,
  type RetentionPatch,
  type RetentionPathColumn,
  type RetentionSubmission,
} from "@/lib/widget-retention";

/**
 * Execution half of the daily widget media retention cron (PULSE-317/341).
 * `/api/cron/widget-retention` is a thin handler over `runWidgetRetention`;
 * Next.js only permits route files to export HTTP handlers, so the orchestration
 * and its tests live here.
 *
 * Walks `widget_submissions` in id-ordered pages, asks the pure policy module
 * `lib/widget-retention` what has outlived its window, deletes those objects
 * from the private `widget-media` bucket, then nulls the matching columns and
 * stamps `media_purged_at` so the media proxy answers 410 (purged) rather than
 * 404 (never attached).
 *
 * Two invariants make the job safe to re-run and safe to half-fail:
 *  - A column is nulled only after its object is confirmed gone. A blob that
 *    fails to delete keeps its path, so tomorrow's run plans it again.
 *  - Planning keys off non-null paths, so a second run the same day finds
 *    nothing to do.
 */

export const WIDGET_RETENTION_SCHEDULE = "0 4 * * *"; // keep in sync with vercel.json
export const WIDGET_RETENTION_MONITOR_SLUG = "widget-retention";

/** Rows per page. Cursor-paginated — we never load the table into memory. */
const PAGE_SIZE = 200;
/** Ceiling on a single run so the cron cannot outlive its function timeout. */
const MAX_PAGES = 25;
/** Objects per Storage `remove` call. */
const DELETE_CHUNK = 100;

const SELECT_COLUMNS =
  "id, created_at, screenshot_storage_path, video_storage_path, replay_storage_path";

const ASSET_SELECT_COLUMNS =
  "id, submission_id, kind, storage_path, created_at, purged_at";

const HAS_ANY_MEDIA =
  "screenshot_storage_path.not.is.null,video_storage_path.not.is.null,replay_storage_path.not.is.null";

export type RetentionRunResult = {
  scanned: number;
  pages: number;
  objectsDeleted: number;
  objectsFailed: number;
  rowsUpdated: number;
  rowUpdatesFailed: number;
  /** True when MAX_PAGES was hit and candidates remain for the next run. */
  truncated: boolean;
  // Per-asset pass (PULSE-403), reported separately from the column pass.
  assetsScanned: number;
  assetPages: number;
  assetObjectsDeleted: number;
  assetObjectsFailed: number;
  assetsPurged: number;
  assetPurgesFailed: number;
  assetsTruncated: boolean;
};

/** I/O seam — the real implementations are below; tests inject fakes. */
export type RetentionDeps = {
  now: Date;
  fetchPage(
    cutoffIso: string,
    afterId: string | null,
    limit: number
  ): Promise<RetentionSubmission[]>;
  deleteObjects(paths: string[]): Promise<void>;
  applyPatch(ids: string[], patch: RetentionPatch): Promise<void>;
  /** Assets past their window that still hold an object, in id order. */
  fetchAssetPage(
    cutoffIso: string,
    afterId: string | null,
    limit: number
  ): Promise<RetentionAsset[]>;
  /** Stamp `purged_at` on the given assets. */
  purgeAssets(ids: string[], purgedAt: string): Promise<void>;
  /**
   * Stamp `media_purged_at` on the given submissions. Keeps the proxy's
   * 410-vs-404 signal correct for a submission whose media only ever existed as
   * asset rows.
   */
  stampSubmissionsPurged(ids: string[], purgedAt: string): Promise<void>;
};

/**
 * Delete a batch, falling back to one-by-one when the batch call fails so a
 * single bad object cannot strand the other 99. Returns the paths still alive.
 */
async function deleteWithFallback(
  paths: string[],
  deleteObjects: RetentionDeps["deleteObjects"]
): Promise<Set<string>> {
  const failed = new Set<string>();

  for (let i = 0; i < paths.length; i += DELETE_CHUNK) {
    const chunk = paths.slice(i, i + DELETE_CHUNK);
    try {
      await deleteObjects(chunk);
    } catch (batchError) {
      console.warn(
        `[widget-retention] Batch delete of ${chunk.length} objects failed, retrying individually:`,
        batchError
      );
      for (const path of chunk) {
        try {
          await deleteObjects([path]);
        } catch (pathError) {
          failed.add(path);
          console.error(
            `[widget-retention] Failed to delete ${path}:`,
            pathError
          );
          Sentry.captureException(pathError, {
            tags: { area: "widget" },
            extra: { storagePath: path },
          });
        }
      }
    }
  }

  return failed;
}

export async function runWidgetRetention(
  deps: RetentionDeps
): Promise<RetentionRunResult> {
  const cutoffIso = candidateCutoff(deps.now, MIN_RETENTION_DAYS);

  const result: RetentionRunResult = {
    scanned: 0,
    pages: 0,
    objectsDeleted: 0,
    objectsFailed: 0,
    rowsUpdated: 0,
    rowUpdatesFailed: 0,
    truncated: false,
    assetsScanned: 0,
    assetPages: 0,
    assetObjectsDeleted: 0,
    assetObjectsFailed: 0,
    assetsPurged: 0,
    assetPurgesFailed: 0,
    assetsTruncated: false,
  };

  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const submissions = await deps.fetchPage(cutoffIso, cursor, PAGE_SIZE);
    if (submissions.length === 0) break;

    result.pages++;
    result.scanned += submissions.length;
    // Advance the cursor before any writes: rows we purge drop out of the
    // filter, so a re-query would otherwise re-shuffle the page window.
    cursor = submissions[submissions.length - 1].id;

    const plan = planRetentionDeletes({ now: deps.now, submissions });
    if (plan.rowUpdates.length === 0) {
      if (submissions.length < PAGE_SIZE) break;
      continue;
    }

    // A path that cannot address a widget-media object is never handed to the
    // bucket — deleteWidgetObjects would reject the whole batch, and a wildcard
    // is not something we want anywhere near a delete call.
    const failedPaths = new Set<string>();
    const deletable: string[] = [];
    for (const path of plan.storagePathsToDelete) {
      if (STORAGE_PATH_PATTERN.test(path)) {
        deletable.push(path);
      } else {
        failedPaths.add(path);
        console.error(`[widget-retention] Refusing malformed path: ${path}`);
        Sentry.captureException(
          new Error(`Malformed widget media storage path: ${path}`),
          { tags: { area: "widget" } }
        );
      }
    }

    const undeleted = await deleteWithFallback(deletable, deps.deleteObjects);
    for (const path of undeleted) failedPaths.add(path);

    result.objectsDeleted += deletable.length - undeleted.size;
    result.objectsFailed += failedPaths.size;

    // Group rows by the exact set of columns to null so each shape costs one
    // UPDATE … WHERE id IN (…) instead of one statement per row.
    const groups = new Map<
      string,
      { columns: RetentionPathColumn[]; ids: string[]; purgedAt: string }
    >();

    for (const row of plan.rowUpdates) {
      const columns = row.expired
        .filter((e) => !failedPaths.has(e.storagePath))
        .map((e) => e.column)
        .sort();
      if (columns.length === 0) continue;

      const key = columns.join(",");
      const group = groups.get(key);
      if (group) {
        group.ids.push(row.id);
      } else {
        groups.set(key, { columns, ids: [row.id], purgedAt: row.purgedAt });
      }
    }

    for (const group of groups.values()) {
      try {
        await deps.applyPatch(
          group.ids,
          retentionPatch(group.columns, group.purgedAt)
        );
        result.rowsUpdated += group.ids.length;
      } catch (updateError) {
        result.rowUpdatesFailed += group.ids.length;
        console.error(
          `[widget-retention] Failed to null [${group.columns.join(", ")}] on ${group.ids.length} rows:`,
          updateError
        );
        Sentry.captureException(updateError, {
          tags: { area: "widget" },
          extra: { columns: group.columns, rowCount: group.ids.length },
        });
      }
    }

    if (submissions.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) result.truncated = true;
  }

  await runAssetRetention(deps, cutoffIso, result);

  return result;
}

/**
 * The per-asset pass (PULSE-403). Same shape as the column pass: page in id
 * order, ask the pure policy what has outlived its window, delete the objects,
 * then stamp `purged_at` only on the assets whose object is confirmed gone.
 *
 * `media_purged_at` is stamped on the parent submissions too. The column pass
 * already does that for a submission whose first attachment lives in a column,
 * but a submission whose media exists only as asset rows would otherwise 404
 * after purging instead of 410.
 */
async function runAssetRetention(
  deps: RetentionDeps,
  cutoffIso: string,
  result: RetentionRunResult
): Promise<void> {
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const assets = await deps.fetchAssetPage(cutoffIso, cursor, PAGE_SIZE);
    if (assets.length === 0) break;

    result.assetPages++;
    result.assetsScanned += assets.length;
    cursor = assets[assets.length - 1].id;

    const plan = planAssetRetentionDeletes({ now: deps.now, assets });
    if (plan.expired.length === 0) {
      if (assets.length < PAGE_SIZE) break;
      continue;
    }

    // A path that cannot address a widget-media object is never handed to the
    // bucket; a wildcard is not something we want near a delete call.
    const failedPaths = new Set<string>();
    const deletable: string[] = [];
    for (const path of plan.storagePathsToDelete) {
      if (STORAGE_PATH_PATTERN.test(path)) {
        deletable.push(path);
      } else {
        failedPaths.add(path);
        console.error(`[widget-retention] Refusing malformed asset path: ${path}`);
        Sentry.captureException(
          new Error(`Malformed widget media storage path: ${path}`),
          { tags: { area: "widget" } }
        );
      }
    }

    const undeleted = await deleteWithFallback(deletable, deps.deleteObjects);
    for (const path of undeleted) failedPaths.add(path);

    result.assetObjectsDeleted += deletable.length - undeleted.size;
    result.assetObjectsFailed += failedPaths.size;

    const purgeable = plan.expired.filter(
      (expiry) => !failedPaths.has(expiry.storagePath)
    );
    if (purgeable.length === 0) continue;

    const assetIds = purgeable.map((expiry) => expiry.assetId);
    try {
      await deps.purgeAssets(assetIds, plan.purgedAt);
      result.assetsPurged += assetIds.length;
    } catch (purgeError) {
      result.assetPurgesFailed += assetIds.length;
      console.error(
        `[widget-retention] Failed to stamp purged_at on ${assetIds.length} asset(s):`,
        purgeError
      );
      Sentry.captureException(purgeError, {
        tags: { area: "widget" },
        extra: { assetCount: assetIds.length },
      });
      // The objects are gone but the rows still point at them; tomorrow's run
      // re-plans them and the delete is idempotent.
      continue;
    }

    const submissionIds = [...new Set(purgeable.map((e) => e.submissionId))];
    try {
      await deps.stampSubmissionsPurged(submissionIds, plan.purgedAt);
    } catch (stampError) {
      // Not fatal: the assets are correctly marked purged, so the proxy answers
      // 410 from the asset row. Only a submission with no asset rows left would
      // fall back to the flag, and the column pass stamps that one.
      console.error(
        `[widget-retention] Failed to stamp media_purged_at on ${submissionIds.length} submission(s):`,
        stampError
      );
      Sentry.captureException(stampError, {
        tags: { area: "widget" },
        extra: { submissionCount: submissionIds.length },
      });
    }

    if (assets.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) result.assetsTruncated = true;
  }
}

async function fetchPage(
  cutoffIso: string,
  afterId: string | null,
  limit: number
): Promise<RetentionSubmission[]> {
  let query = supabaseAdmin
    .from("widget_submissions")
    .select(SELECT_COLUMNS)
    .lte("created_at", cutoffIso)
    .or(HAS_ANY_MEDIA)
    .order("id", { ascending: true })
    .limit(limit);

  if (afterId) query = query.gt("id", afterId);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch retention candidates: ${error.message}`);
  }
  return (data ?? []) as unknown as RetentionSubmission[];
}

async function applyPatch(
  ids: string[],
  patch: RetentionPatch
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("widget_submissions")
    .update(patch)
    .in("id", ids);

  if (error) {
    throw new Error(`Failed to apply retention patch: ${error.message}`);
  }
}


async function fetchAssetPage(
  cutoffIso: string,
  afterId: string | null,
  limit: number
): Promise<RetentionAsset[]> {
  let query = supabaseAdmin
    .from("widget_submission_assets")
    .select(ASSET_SELECT_COLUMNS)
    .lte("created_at", cutoffIso)
    .is("purged_at", null)
    .not("storage_path", "is", null)
    .order("id", { ascending: true })
    .limit(limit);

  if (afterId) query = query.gt("id", afterId);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to fetch asset retention candidates: ${error.message}`);
  }
  return (data ?? []) as unknown as RetentionAsset[];
}

async function purgeAssets(ids: string[], purgedAt: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("widget_submission_assets")
    .update({ purged_at: purgedAt })
    .in("id", ids);

  if (error) {
    throw new Error(`Failed to stamp purged_at on assets: ${error.message}`);
  }
}

async function stampSubmissionsPurged(
  ids: string[],
  purgedAt: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("widget_submissions")
    .update({ media_purged_at: purgedAt })
    .in("id", ids);

  if (error) {
    throw new Error(`Failed to stamp media_purged_at: ${error.message}`);
  }
}

/** The production I/O wiring; the route passes this straight to the runner. */
export function liveRetentionDeps(now: Date): RetentionDeps {
  return {
    now,
    fetchPage,
    deleteObjects: (paths) => deleteWidgetObjects(paths),
    applyPatch,
    fetchAssetPage,
    purgeAssets,
    stampSubmissionsPurged,
  };
}
