/**
 * Retention policy for widget media (PULSE-317/340).
 *
 * Pure decision module: given the current time and a page of submission rows,
 * it returns which storage objects have outlived their window and which row
 * columns must be nulled once those objects are gone. It performs no Supabase
 * or Storage calls and imports nothing that does — `/api/cron/widget-retention`
 * owns all I/O, so this file is testable against a fake clock alone.
 *
 * Windows are per artefact kind, not per row: a 45-day-old submission loses its
 * video and replay but keeps its screenshot until day 90. That is why the cron's
 * candidate query filters on the SHORTEST window (`candidateCutoff`) rather than
 * the longest — filtering on 90d would leave expired video sitting behind a
 * still-live screenshot forever.
 */

export type WidgetMediaKind = "screenshot" | "video" | "replay";

/** Days each artefact kind is kept. Tunable in one place; see the PRD. */
export const RETENTION_DAYS = {
  screenshot: 90,
  video: 30,
  replay: 30,
} as const satisfies Record<WidgetMediaKind, number>;

/** Column holding each kind's object key on `widget_submissions`. */
export const RETENTION_PATH_COLUMNS = {
  screenshot: "screenshot_storage_path",
  video: "video_storage_path",
  replay: "replay_storage_path",
} as const satisfies Record<WidgetMediaKind, string>;

export type RetentionPathColumn =
  (typeof RETENTION_PATH_COLUMNS)[WidgetMediaKind];

const KINDS = Object.keys(RETENTION_DAYS) as WidgetMediaKind[];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shortest window across all kinds — the cron's candidate cutoff. */
export const MIN_RETENTION_DAYS = Math.min(...Object.values(RETENTION_DAYS));

/** Longest window across all kinds; nothing survives past it. */
export const MAX_RETENTION_DAYS = Math.max(...Object.values(RETENTION_DAYS));

/** The subset of `widget_submissions` the policy reads. */
export type RetentionSubmission = {
  id: string;
  created_at: string;
  screenshot_storage_path: string | null;
  video_storage_path: string | null;
  replay_storage_path: string | null;
};

/** One artefact that has outlived its window and still has an object to delete. */
export type RetentionExpiry = {
  kind: WidgetMediaKind;
  column: RetentionPathColumn;
  storagePath: string;
};

export type RetentionRowUpdate = {
  id: string;
  /**
   * Every expired artefact on this row. The cron nulls a column only after the
   * matching object is actually gone, so it may apply a subset of these when an
   * individual delete fails — the rest is retried on tomorrow's run.
   */
  expired: RetentionExpiry[];
  /** Value for `media_purged_at`; how the media proxy tells 410 from 404. */
  purgedAt: string;
};

export type RetentionPlan = {
  /** Flattened, de-duplicated union of every `expired[].storagePath`. */
  storagePathsToDelete: string[];
  rowUpdates: RetentionRowUpdate[];
};

export type RetentionPatch = Partial<Record<RetentionPathColumn, null>> & {
  media_purged_at: string;
};

export type PlanRetentionDeletesInput = {
  now: Date;
  submissions: Iterable<RetentionSubmission>;
};

/** ISO timestamp before which a row may hold at least one expired artefact. */
export function candidateCutoff(now: Date, days = MIN_RETENTION_DAYS): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/**
 * The row patch for a set of successfully deleted columns. Kept here so column
 * names never leak into the route.
 */
export function retentionPatch(
  columns: readonly RetentionPathColumn[],
  purgedAt: string
): RetentionPatch {
  const patch = { media_purged_at: purgedAt } as RetentionPatch;
  for (const column of columns) patch[column] = null;
  return patch;
}

/**
 * Decide what to purge. A row contributes an expiry only when its artefact is
 * at or past its window AND the column is still non-null, which is what makes
 * a re-run the same day a no-op: the first run nulled the columns.
 */
export function planRetentionDeletes(
  input: PlanRetentionDeletesInput
): RetentionPlan {
  const nowMs = input.now.getTime();
  const purgedAt = input.now.toISOString();

  const rowUpdates: RetentionRowUpdate[] = [];
  const paths = new Set<string>();

  for (const submission of input.submissions) {
    const createdMs = Date.parse(submission.created_at);
    // An unparseable timestamp means we cannot prove the row is expired, so we
    // keep the media. Failing closed here is the only safe direction.
    if (Number.isNaN(createdMs)) continue;

    const ageMs = nowMs - createdMs;
    const expired: RetentionExpiry[] = [];

    for (const kind of KINDS) {
      if (ageMs < RETENTION_DAYS[kind] * DAY_MS) continue;

      const column = RETENTION_PATH_COLUMNS[kind];
      const storagePath = submission[column];
      if (!storagePath) continue;

      expired.push({ kind, column, storagePath });
      paths.add(storagePath);
    }

    if (expired.length > 0) {
      rowUpdates.push({ id: submission.id, expired, purgedAt });
    }
  }

  return { storagePathsToDelete: [...paths], rowUpdates };
}
