import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: () => ({}) } }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import {
  WIDGET_RETENTION_SCHEDULE,
  runWidgetRetention,
  type RetentionDeps,
} from "../widget-retention-run";
import type {
  RetentionAsset,
  RetentionPatch,
  RetentionSubmission,
} from "../widget-retention";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-20T04:00:00.000Z");
const HUB = "11111111-1111-1111-1111-111111111111";
const PAGE_SIZE = 200;

type PatchCall = { ids: string[]; patch: RetentionPatch };

function agedDays(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

/** id must sort ascending for the cursor assertions to mean anything. */
function row(
  n: number,
  days: number,
  media: Partial<RetentionSubmission> = {}
): RetentionSubmission {
  const id = `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
  return {
    id,
    created_at: agedDays(days),
    screenshot_storage_path: null,
    video_storage_path: null,
    replay_storage_path: null,
    ...media,
  };
}

function withAllMedia(n: number, days: number): RetentionSubmission {
  const tag = String(n).padStart(8, "0");
  return row(n, days, {
    screenshot_storage_path: `${HUB}/screenshots/${tag}.png`,
    video_storage_path: `${HUB}/videos/${tag}.webm`,
    replay_storage_path: `${HUB}/replays/${tag}.json`,
  });
}

type PurgeCall = { ids: string[]; purgedAt: string };

type Harness = {
  deps: RetentionDeps;
  deleted: string[][];
  patches: PatchCall[];
  fetchArgs: Array<{ cutoffIso: string; afterId: string | null; limit: number }>;
  assetFetchArgs: Array<{
    cutoffIso: string;
    afterId: string | null;
    limit: number;
  }>;
  assetPurges: PurgeCall[];
  submissionStamps: PurgeCall[];
};

/** id must sort ascending for the cursor assertions to mean anything. */
function assetRow(
  n: number,
  days: number,
  overrides: Partial<RetentionAsset> = {}
): RetentionAsset {
  const tag = String(n).padStart(8, "0");
  return {
    id: `${tag}-0000-4000-8000-00000000000a`,
    submission_id: `${tag}-0000-4000-8000-000000000000`,
    kind: "screenshot",
    storage_path: `${HUB}/screenshots/${tag}.png`,
    created_at: agedDays(days),
    purged_at: null,
    ...overrides,
  };
}

/**
 * `pages` is served one call at a time; anything after the list is an empty
 * page, which is how the loop learns it is done.
 */
function harness(
  pages: RetentionSubmission[][],
  overrides: {
    failDelete?: (paths: string[]) => boolean;
    failPatch?: (call: PatchCall) => boolean;
    assetPages?: RetentionAsset[][];
    failAssetPurge?: (call: PurgeCall) => boolean;
    failSubmissionStamp?: (call: PurgeCall) => boolean;
  } = {}
): Harness {
  const deleted: string[][] = [];
  const patches: PatchCall[] = [];
  const fetchArgs: Harness["fetchArgs"] = [];
  const assetFetchArgs: Harness["assetFetchArgs"] = [];
  const assetPurges: PurgeCall[] = [];
  const submissionStamps: PurgeCall[] = [];
  let page = 0;
  let assetPage = 0;

  const deps: RetentionDeps = {
    now: NOW,
    async fetchPage(cutoffIso, afterId, limit) {
      fetchArgs.push({ cutoffIso, afterId, limit });
      return pages[page++] ?? [];
    },
    async deleteObjects(paths) {
      if (overrides.failDelete?.(paths)) {
        throw new Error(`delete failed (${paths.length} path(s))`);
      }
      deleted.push(paths);
    },
    async applyPatch(ids, patch) {
      const call = { ids, patch };
      if (overrides.failPatch?.(call)) throw new Error("patch failed");
      patches.push(call);
    },
    async fetchAssetPage(cutoffIso, afterId, limit) {
      assetFetchArgs.push({ cutoffIso, afterId, limit });
      return overrides.assetPages?.[assetPage++] ?? [];
    },
    async purgeAssets(ids, purgedAt) {
      const call = { ids, purgedAt };
      if (overrides.failAssetPurge?.(call)) throw new Error("asset purge failed");
      assetPurges.push(call);
    },
    async stampSubmissionsPurged(ids, purgedAt) {
      const call = { ids, purgedAt };
      if (overrides.failSubmissionStamp?.(call)) {
        throw new Error("submission stamp failed");
      }
      submissionStamps.push(call);
    },
  };

  return {
    deps,
    deleted,
    patches,
    fetchArgs,
    assetFetchArgs,
    assetPurges,
    submissionStamps,
  };
}

/** Every path handed to the bucket across all calls. */
function flatDeleted(h: Harness): string[] {
  return h.deleted.flat().sort();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runWidgetRetention — candidate query", () => {
  it("filters on the shortest window so 45-day-old video is picked up", async () => {
    const h = harness([[withAllMedia(1, 45)]]);
    await runWidgetRetention(h.deps);

    expect(h.fetchArgs[0].cutoffIso).toBe(agedDays(30));
    expect(h.fetchArgs[0].afterId).toBeNull();
    expect(h.fetchArgs[0].limit).toBe(PAGE_SIZE);
  });

  it("does nothing when no candidates come back", async () => {
    const h = harness([[]]);
    const result = await runWidgetRetention(h.deps);

    expect(result).toMatchObject({
      scanned: 0,
      pages: 0,
      objectsDeleted: 0,
      rowsUpdated: 0,
      truncated: false,
    });
    expect(h.deleted).toEqual([]);
    expect(h.patches).toEqual([]);
  });

  it("stops after a short page rather than fetching again", async () => {
    const h = harness([[withAllMedia(1, 200)]]);
    await runWidgetRetention(h.deps);
    expect(h.fetchArgs).toHaveLength(1);
  });

  it("advances the cursor to the last id of each full page", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) =>
      withAllMedia(i + 1, 200)
    );
    const h = harness([full, [withAllMedia(999, 200)]]);
    await runWidgetRetention(h.deps);

    expect(h.fetchArgs).toHaveLength(2);
    expect(h.fetchArgs[1].afterId).toBe(full[full.length - 1].id);
  });

  it("keeps paging past a page where nothing is expired", async () => {
    // A full page of fresh rows still advances the cursor.
    const fresh = Array.from({ length: PAGE_SIZE }, (_, i) => row(i + 1, 1));
    const h = harness([fresh, [withAllMedia(999, 200)]]);
    const result = await runWidgetRetention(h.deps);

    expect(h.fetchArgs).toHaveLength(2);
    expect(h.fetchArgs[1].afterId).toBe(fresh[fresh.length - 1].id);
    expect(result.scanned).toBe(PAGE_SIZE + 1);
    expect(result.rowsUpdated).toBe(1);
  });

  it("flags truncated when the page ceiling is hit", async () => {
    const fullPage = () =>
      Array.from({ length: PAGE_SIZE }, (_, i) => withAllMedia(i + 1, 200));
    const h = harness(Array.from({ length: 30 }, fullPage));
    const result = await runWidgetRetention(h.deps);

    expect(result.pages).toBe(25);
    expect(result.truncated).toBe(true);
  });
});

describe("runWidgetRetention — deleting and nulling", () => {
  it("deletes expired objects and nulls exactly those columns", async () => {
    const h = harness([[withAllMedia(1, 200)]]);
    const result = await runWidgetRetention(h.deps);

    expect(flatDeleted(h)).toEqual(
      [
        `${HUB}/replays/00000001.json`,
        `${HUB}/screenshots/00000001.png`,
        `${HUB}/videos/00000001.webm`,
      ].sort()
    );
    expect(h.patches).toHaveLength(1);
    expect(h.patches[0].patch).toEqual({
      screenshot_storage_path: null,
      video_storage_path: null,
      replay_storage_path: null,
      media_purged_at: NOW.toISOString(),
    });
    expect(result).toMatchObject({
      objectsDeleted: 3,
      objectsFailed: 0,
      rowsUpdated: 1,
      rowUpdatesFailed: 0,
    });
  });

  it("leaves a still-live screenshot alone at 45 days", async () => {
    const h = harness([[withAllMedia(1, 45)]]);
    await runWidgetRetention(h.deps);

    expect(flatDeleted(h)).toEqual(
      [`${HUB}/replays/00000001.json`, `${HUB}/videos/00000001.webm`].sort()
    );
    expect(h.patches[0].patch).toEqual({
      video_storage_path: null,
      replay_storage_path: null,
      media_purged_at: NOW.toISOString(),
    });
    expect(h.patches[0].patch).not.toHaveProperty("screenshot_storage_path");
  });

  it("groups rows sharing a column set into one bulk update", async () => {
    const h = harness([
      [withAllMedia(1, 200), withAllMedia(2, 200), withAllMedia(3, 45)],
    ]);
    await runWidgetRetention(h.deps);

    // Two shapes: all-three (rows 1,2) and video+replay (row 3).
    expect(h.patches).toHaveLength(2);
    const allThree = h.patches.find((p) => p.ids.length === 2);
    expect(allThree?.ids).toEqual([
      withAllMedia(1, 200).id,
      withAllMedia(2, 200).id,
    ]);
  });

  it("stamps media_purged_at on every update", async () => {
    const h = harness([[withAllMedia(1, 200), withAllMedia(2, 45)]]);
    await runWidgetRetention(h.deps);

    expect(h.patches).toHaveLength(2);
    for (const call of h.patches) {
      expect(call.patch.media_purged_at).toBe(NOW.toISOString());
    }
  });

  it("is a no-op on a same-day re-run once paths are null", async () => {
    const h = harness([[row(1, 200)]]);
    const result = await runWidgetRetention(h.deps);

    expect(h.deleted).toEqual([]);
    expect(h.patches).toEqual([]);
    expect(result).toMatchObject({ scanned: 1, rowsUpdated: 0 });
  });
});

describe("runWidgetRetention — failure isolation", () => {
  it("retries a failed batch one object at a time", async () => {
    const bad = `${HUB}/videos/00000001.webm`;
    const h = harness([[withAllMedia(1, 200)]], {
      // Fail the batch call, then fail only the one bad path on retry.
      failDelete: (paths) => paths.length > 1 || paths[0] === bad,
    });
    const result = await runWidgetRetention(h.deps);

    expect(flatDeleted(h)).toEqual(
      [`${HUB}/replays/00000001.json`, `${HUB}/screenshots/00000001.png`].sort()
    );
    expect(result).toMatchObject({ objectsDeleted: 2, objectsFailed: 1 });
  });

  it("keeps the path of a blob it could not delete so tomorrow retries it", async () => {
    const bad = `${HUB}/videos/00000001.webm`;
    const h = harness([[withAllMedia(1, 200)]], {
      failDelete: (paths) => paths.length > 1 || paths[0] === bad,
    });
    await runWidgetRetention(h.deps);

    expect(h.patches).toHaveLength(1);
    expect(h.patches[0].patch).toEqual({
      screenshot_storage_path: null,
      replay_storage_path: null,
      media_purged_at: NOW.toISOString(),
    });
    expect(h.patches[0].patch).not.toHaveProperty("video_storage_path");
  });

  it("skips the row update entirely when every delete failed", async () => {
    const h = harness([[withAllMedia(1, 200)]], { failDelete: () => true });
    const result = await runWidgetRetention(h.deps);

    expect(h.patches).toEqual([]);
    expect(result).toMatchObject({ objectsDeleted: 0, objectsFailed: 3 });
  });

  it("never hands a malformed path to the bucket", async () => {
    const h = harness([
      [row(1, 200, { video_storage_path: "../../etc/passwd" })],
    ]);
    const result = await runWidgetRetention(h.deps);

    expect(h.deleted).toEqual([]);
    expect(h.patches).toEqual([]);
    expect(result.objectsFailed).toBe(1);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("carries on after a failed row update and reports it", async () => {
    const h = harness([[withAllMedia(1, 200), withAllMedia(2, 45)]], {
      failPatch: (call) => call.ids.length === 1 && call.patch
        .screenshot_storage_path === null,
    });
    const result = await runWidgetRetention(h.deps);

    expect(result.rowUpdatesFailed).toBe(1);
    expect(result.rowsUpdated).toBe(1);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("does not abort the run when one page's deletes fail", async () => {
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) =>
      withAllMedia(i + 1, 200)
    );
    const h = harness([fullPage, [withAllMedia(999, 200)]], {
      failDelete: (paths) => paths.length > 1,
    });
    const result = await runWidgetRetention(h.deps);

    expect(result.pages).toBe(2);
    expect(result.scanned).toBe(PAGE_SIZE + 1);
  });
});

describe("schedule", () => {
  it("runs daily at 04:00 UTC", () => {
    expect(WIDGET_RETENTION_SCHEDULE).toBe("0 4 * * *");
  });

  // Vercel is the deploy target that owns cron (wrangler.jsonc has no
  // triggers). The route's Sentry monitor is registered from the constant, so
  // a drift between the two would silently mis-report the check-in window.
  it("is registered in vercel.json at the same cadence", () => {
    const config = JSON.parse(
      readFileSync(join(process.cwd(), "vercel.json"), "utf8")
    ) as { crons: Array<{ path: string; schedule: string }> };

    const entry = config.crons.find(
      (c) => c.path === "/api/cron/widget-retention"
    );
    expect(entry).toBeDefined();
    expect(entry?.schedule).toBe(WIDGET_RETENTION_SCHEDULE);
  });
});

describe("runWidgetRetention — per-asset pass (PULSE-403)", () => {
  it("deletes the object, stamps the asset and stamps its submission", async () => {
    const asset = assetRow(1, 200);
    const h = harness([[]], { assetPages: [[asset]] });

    const result = await runWidgetRetention(h.deps);

    expect(flatDeleted(h)).toEqual([asset.storage_path]);
    expect(h.assetPurges).toEqual([
      { ids: [asset.id], purgedAt: NOW.toISOString() },
    ]);
    // Keeps the proxy answering 410 for a submission whose media only ever
    // existed as asset rows.
    expect(h.submissionStamps).toEqual([
      { ids: [asset.submission_id], purgedAt: NOW.toISOString() },
    ]);
    expect(result).toMatchObject({
      assetsScanned: 1,
      assetPages: 1,
      assetObjectsDeleted: 1,
      assetsPurged: 1,
      assetObjectsFailed: 0,
      assetPurgesFailed: 0,
      assetsTruncated: false,
    });
  });

  it("uses the shortest window as the candidate cutoff, like the column pass", async () => {
    const h = harness([[]], { assetPages: [[assetRow(1, 45)]] });
    await runWidgetRetention(h.deps);

    expect(h.assetFetchArgs[0]).toEqual({
      cutoffIso: agedDays(30),
      afterId: null,
      limit: PAGE_SIZE,
    });
  });

  it("keeps the per-kind windows: 45-day video goes, 45-day screenshot stays", async () => {
    const h = harness([[]], {
      assetPages: [
        [
          assetRow(1, 45, { kind: "screenshot" }),
          assetRow(2, 45, {
            kind: "video",
            storage_path: `${HUB}/videos/00000002.webm`,
          }),
        ],
      ],
    });

    const result = await runWidgetRetention(h.deps);

    expect(flatDeleted(h)).toEqual([`${HUB}/videos/00000002.webm`]);
    expect(result.assetsPurged).toBe(1);
  });

  it("purges every attachment of a multi-screenshot submission", async () => {
    const submissionId = "00000001-0000-4000-8000-000000000000";
    const assets = [1, 2, 3].map((n) =>
      assetRow(n, 200, { submission_id: submissionId })
    );
    const h = harness([[]], { assetPages: [assets] });

    const result = await runWidgetRetention(h.deps);

    expect(result.assetsPurged).toBe(3);
    expect(h.assetPurges[0].ids).toHaveLength(3);
    // One stamp for the submission, not one per asset.
    expect(h.submissionStamps).toEqual([
      { ids: [submissionId], purgedAt: NOW.toISOString() },
    ]);
  });

  it("skips an asset already stamped, so a same-day re-run is a no-op", async () => {
    const h = harness([[]], {
      assetPages: [[assetRow(1, 200, { purged_at: NOW.toISOString() })]],
    });

    const result = await runWidgetRetention(h.deps);

    expect(h.deleted).toEqual([]);
    expect(h.assetPurges).toEqual([]);
    expect(result.assetsScanned).toBe(1);
    expect(result.assetsPurged).toBe(0);
  });

  it("does not stamp an asset whose object failed to delete", async () => {
    const h = harness([[]], {
      assetPages: [[assetRow(1, 200)]],
      failDelete: () => true,
    });

    const result = await runWidgetRetention(h.deps);

    expect(h.assetPurges).toEqual([]);
    expect(h.submissionStamps).toEqual([]);
    expect(result.assetObjectsFailed).toBe(1);
    expect(result.assetsPurged).toBe(0);
  });

  it("stamps the assets whose objects went and leaves the one that did not", async () => {
    const good = assetRow(1, 200);
    const bad = assetRow(2, 200, {
      storage_path: `${HUB}/screenshots/stuck.png`,
    });
    const h = harness([[]], {
      assetPages: [[good, bad]],
      failDelete: (paths) => paths.includes(bad.storage_path!),
    });

    const result = await runWidgetRetention(h.deps);

    expect(h.assetPurges[0].ids).toEqual([good.id]);
    expect(result.assetsPurged).toBe(1);
    expect(result.assetObjectsFailed).toBe(1);
  });

  it("refuses a malformed asset path rather than handing it to the bucket", async () => {
    const h = harness([[]], {
      assetPages: [[assetRow(1, 200, { storage_path: "../../etc/passwd" })]],
    });

    const result = await runWidgetRetention(h.deps);

    expect(h.deleted).toEqual([]);
    expect(h.assetPurges).toEqual([]);
    expect(result.assetObjectsFailed).toBe(1);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("leaves an unrecognised kind alone — no window it can prove", async () => {
    const h = harness([[]], {
      assetPages: [[assetRow(1, 3650, { kind: "document" })]],
    });

    const result = await runWidgetRetention(h.deps);

    expect(h.deleted).toEqual([]);
    expect(result.assetsPurged).toBe(0);
  });

  it("keeps media whose created_at will not parse", async () => {
    const h = harness([[]], {
      assetPages: [[assetRow(1, 200, { created_at: "not-a-date" })]],
    });

    const result = await runWidgetRetention(h.deps);

    expect(h.deleted).toEqual([]);
    expect(result.assetsPurged).toBe(0);
  });

  it("counts a failed purge and does not claim the assets were stamped", async () => {
    const h = harness([[]], {
      assetPages: [[assetRow(1, 200)]],
      failAssetPurge: () => true,
    });

    const result = await runWidgetRetention(h.deps);

    expect(result.assetPurgesFailed).toBe(1);
    expect(result.assetsPurged).toBe(0);
    expect(h.submissionStamps).toEqual([]);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("does not undo the asset purge when the submission stamp fails", async () => {
    const h = harness([[]], {
      assetPages: [[assetRow(1, 200)]],
      failSubmissionStamp: () => true,
    });

    const result = await runWidgetRetention(h.deps);

    expect(result.assetsPurged).toBe(1);
    expect(h.submissionStamps).toEqual([]);
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("pages assets in id order, advancing the cursor past each full page", async () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) =>
      assetRow(i + 1, 200)
    );
    const h = harness([[]], { assetPages: [full, [assetRow(999, 200)]] });

    const result = await runWidgetRetention(h.deps);

    // The second page is short, so the loop stops rather than fetching again.
    expect(h.assetFetchArgs.map((a) => a.afterId)).toEqual([
      null,
      full[full.length - 1].id,
    ]);
    expect(result.assetPages).toBe(2);
    expect(result.assetsScanned).toBe(PAGE_SIZE + 1);
  });

  it("runs both passes: legacy columns and asset rows in one job", async () => {
    const h = harness([[withAllMedia(1, 200)]], {
      assetPages: [[assetRow(2, 200)]],
    });

    const result = await runWidgetRetention(h.deps);

    expect(result.rowsUpdated).toBe(1);
    expect(result.assetsPurged).toBe(1);
    expect(result.objectsDeleted).toBe(3);
    expect(result.assetObjectsDeleted).toBe(1);
  });

  it("reports zeroes for the asset pass when nothing is due", async () => {
    const h = harness([[]]);
    const result = await runWidgetRetention(h.deps);

    expect(result).toMatchObject({
      assetsScanned: 0,
      assetPages: 0,
      assetObjectsDeleted: 0,
      assetObjectsFailed: 0,
      assetsPurged: 0,
      assetPurgesFailed: 0,
      assetsTruncated: false,
    });
  });
});
