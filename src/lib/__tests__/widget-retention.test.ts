import { describe, expect, it } from "vitest";

import {
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  RETENTION_DAYS,
  RETENTION_PATH_COLUMNS,
  candidateCutoff,
  planAssetRetentionDeletes,
  planRetentionDeletes,
  retentionPatch,
  type RetentionAsset,
  type RetentionSubmission,
} from "../widget-retention";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fake clock — every case is expressed as an age relative to this instant. */
const NOW = new Date("2026-08-20T04:00:00.000Z");

const HUB = "11111111-1111-1111-1111-111111111111";

function agedDays(days: number, offsetMs = 0): string {
  return new Date(NOW.getTime() - days * DAY_MS + offsetMs).toISOString();
}

function submission(
  overrides: Partial<RetentionSubmission> & { id: string }
): RetentionSubmission {
  return {
    created_at: agedDays(0),
    screenshot_storage_path: null,
    video_storage_path: null,
    replay_storage_path: null,
    ...overrides,
  };
}

/** A row with all three artefacts attached, aged `days` old. */
function fullRow(id: string, days: number, offsetMs = 0): RetentionSubmission {
  return submission({
    id,
    created_at: agedDays(days, offsetMs),
    screenshot_storage_path: `${HUB}/screenshots/${id}.png`,
    video_storage_path: `${HUB}/videos/${id}.webm`,
    replay_storage_path: `${HUB}/replays/${id}.json`,
  });
}

function plan(submissions: RetentionSubmission[]) {
  return planRetentionDeletes({ now: NOW, submissions });
}

function kindsFor(
  result: ReturnType<typeof plan>,
  id: string
): string[] {
  const row = result.rowUpdates.find((r) => r.id === id);
  return (row?.expired ?? []).map((e) => e.kind).sort();
}

describe("widget-retention constants", () => {
  it("keeps screenshots 90 days and video/replay 30", () => {
    expect(RETENTION_DAYS).toEqual({
      screenshot: 90,
      video: 30,
      replay: 30,
    });
    expect(MIN_RETENTION_DAYS).toBe(30);
    expect(MAX_RETENTION_DAYS).toBe(90);
  });

  it("maps each kind to its storage path column", () => {
    expect(RETENTION_PATH_COLUMNS).toEqual({
      screenshot: "screenshot_storage_path",
      video: "video_storage_path",
      replay: "replay_storage_path",
    });
  });
});

describe("candidateCutoff", () => {
  it("defaults to the shortest window so 45-day-old video is still a candidate", () => {
    expect(candidateCutoff(NOW)).toBe(agedDays(30));
    // A row older than the cutoff but younger than 90d must still be selected.
    expect(agedDays(45) < candidateCutoff(NOW)).toBe(true);
  });

  it("accepts an explicit window", () => {
    expect(candidateCutoff(NOW, 90)).toBe(agedDays(90));
  });
});

describe("planRetentionDeletes", () => {
  it("returns an empty plan for no submissions", () => {
    expect(plan([])).toEqual({ storagePathsToDelete: [], rowUpdates: [] });
  });

  it("deletes nothing when every artefact is inside its window", () => {
    const result = plan([fullRow("a", 10), fullRow("b", 29)]);
    expect(result).toEqual({ storagePathsToDelete: [], rowUpdates: [] });
  });

  it("expires video and replay but not screenshots at the 30d boundary", () => {
    const result = plan([fullRow("mixed", 30)]);

    expect(kindsFor(result, "mixed")).toEqual(["replay", "video"]);
    expect(result.storagePathsToDelete.sort()).toEqual(
      [`${HUB}/replays/mixed.json`, `${HUB}/videos/mixed.webm`].sort()
    );
    expect(result.storagePathsToDelete).not.toContain(
      `${HUB}/screenshots/mixed.png`
    );
  });

  it("keeps video one millisecond short of 30 days", () => {
    // agedDays(30, +1ms) is 1ms younger than the boundary.
    const result = plan([fullRow("young", 30, 1)]);
    expect(result.rowUpdates).toEqual([]);
    expect(result.storagePathsToDelete).toEqual([]);
  });

  it("expires screenshots exactly at the 90d boundary, not a millisecond before", () => {
    const atBoundary = plan([
      submission({
        id: "shot",
        created_at: agedDays(90),
        screenshot_storage_path: `${HUB}/screenshots/shot.png`,
      }),
    ]);
    expect(kindsFor(atBoundary, "shot")).toEqual(["screenshot"]);

    const justInside = plan([
      submission({
        id: "shot",
        created_at: agedDays(90, 1),
        screenshot_storage_path: `${HUB}/screenshots/shot.png`,
      }),
    ]);
    expect(justInside.rowUpdates).toEqual([]);
  });

  it("expires all three kinds once a row is past the longest window", () => {
    const result = plan([fullRow("old", 120)]);

    expect(kindsFor(result, "old")).toEqual(["replay", "screenshot", "video"]);
    expect(result.storagePathsToDelete).toHaveLength(3);
    expect(result.rowUpdates[0].purgedAt).toBe(NOW.toISOString());
  });

  it("pairs each expiry with the column the cron must null", () => {
    const result = plan([fullRow("cols", 120)]);
    const byKind = Object.fromEntries(
      result.rowUpdates[0].expired.map((e) => [e.kind, e.column])
    );

    expect(byKind).toEqual({
      screenshot: "screenshot_storage_path",
      video: "video_storage_path",
      replay: "replay_storage_path",
    });
  });

  it("is a no-op for a row that never had media", () => {
    const result = plan([submission({ id: "bare", created_at: agedDays(200) })]);
    expect(result).toEqual({ storagePathsToDelete: [], rowUpdates: [] });
  });

  it("is a no-op for a row already purged — idempotent on a same-day re-run", () => {
    const first = plan([fullRow("dup", 120)]);
    expect(first.rowUpdates).toHaveLength(1);

    // Second run sees the columns the first run nulled.
    const second = plan([
      submission({ id: "dup", created_at: agedDays(120) }),
    ]);
    expect(second).toEqual({ storagePathsToDelete: [], rowUpdates: [] });
  });

  it("purges only the columns still holding a path", () => {
    const result = plan([
      submission({
        id: "partial",
        created_at: agedDays(120),
        // video already purged on an earlier run
        screenshot_storage_path: `${HUB}/screenshots/partial.png`,
        replay_storage_path: `${HUB}/replays/partial.json`,
      }),
    ]);

    expect(kindsFor(result, "partial")).toEqual(["replay", "screenshot"]);
    expect(result.storagePathsToDelete).toHaveLength(2);
  });

  it("skips rows with an unparseable created_at rather than deleting them", () => {
    const result = plan([
      submission({
        id: "bad",
        created_at: "not-a-timestamp",
        video_storage_path: `${HUB}/videos/bad.webm`,
      }),
    ]);

    expect(result).toEqual({ storagePathsToDelete: [], rowUpdates: [] });
  });

  it("de-duplicates storage paths shared across rows", () => {
    const shared = `${HUB}/videos/shared.webm`;
    const result = plan([
      submission({
        id: "one",
        created_at: agedDays(60),
        video_storage_path: shared,
      }),
      submission({
        id: "two",
        created_at: agedDays(70),
        video_storage_path: shared,
      }),
    ]);

    expect(result.storagePathsToDelete).toEqual([shared]);
    expect(result.rowUpdates).toHaveLength(2);
  });

  it("plans across a mixed page, emitting a row update only where work exists", () => {
    const result = plan([
      fullRow("fresh", 5),
      fullRow("mid", 45),
      fullRow("ancient", 400),
      submission({ id: "empty", created_at: agedDays(400) }),
    ]);

    expect(result.rowUpdates.map((r) => r.id)).toEqual(["mid", "ancient"]);
    expect(kindsFor(result, "mid")).toEqual(["replay", "video"]);
    expect(kindsFor(result, "ancient")).toEqual([
      "replay",
      "screenshot",
      "video",
    ]);
    expect(result.storagePathsToDelete).toHaveLength(5);
  });

  it("accepts any iterable of submissions", () => {
    const rows = new Set([fullRow("iter", 120)]);
    expect(planRetentionDeletes({ now: NOW, submissions: rows }).rowUpdates)
      .toHaveLength(1);
  });
});

describe("retentionPatch", () => {
  it("nulls the given columns and stamps media_purged_at", () => {
    expect(
      retentionPatch(
        ["video_storage_path", "replay_storage_path"],
        NOW.toISOString()
      )
    ).toEqual({
      video_storage_path: null,
      replay_storage_path: null,
      media_purged_at: NOW.toISOString(),
    });
  });

  it("stamps media_purged_at even for an empty column set", () => {
    expect(retentionPatch([], NOW.toISOString())).toEqual({
      media_purged_at: NOW.toISOString(),
    });
  });
});

// -- Per-asset retention (PULSE-403) --------------------------------------

function asset(
  overrides: Partial<RetentionAsset> & { id: string }
): RetentionAsset {
  return {
    submission_id: "sub-1",
    kind: "screenshot",
    storage_path: `${HUB}/screenshots/${overrides.id}.png`,
    created_at: agedDays(0),
    purged_at: null,
    ...overrides,
  };
}

describe("planAssetRetentionDeletes", () => {
  it("expires an asset at exactly its window, not a millisecond before", () => {
    const onTheDay = planAssetRetentionDeletes({
      now: NOW,
      assets: [asset({ id: "a", created_at: agedDays(90) })],
    });
    const oneMsShort = planAssetRetentionDeletes({
      now: NOW,
      assets: [asset({ id: "a", created_at: agedDays(90, 1) })],
    });

    expect(onTheDay.expired).toHaveLength(1);
    expect(oneMsShort.expired).toEqual([]);
    expect(oneMsShort.storagePathsToDelete).toEqual([]);
  });

  it("measures from the asset's own created_at, not the submission's", () => {
    // A screenshot attached today to a two-year-old submission keeps its window.
    const plan = planAssetRetentionDeletes({
      now: NOW,
      assets: [asset({ id: "fresh", created_at: agedDays(1) })],
    });
    expect(plan.expired).toEqual([]);
  });

  it("applies the per-kind window", () => {
    const plan = planAssetRetentionDeletes({
      now: NOW,
      assets: [
        asset({ id: "shot", kind: "screenshot", created_at: agedDays(45) }),
        asset({
          id: "clip",
          kind: "video",
          storage_path: `${HUB}/videos/clip.webm`,
          created_at: agedDays(45),
        }),
        asset({
          id: "rec",
          kind: "replay",
          storage_path: `${HUB}/replays/rec.json`,
          created_at: agedDays(45),
        }),
      ],
    });

    expect(plan.expired.map((e) => e.assetId).sort()).toEqual(["clip", "rec"]);
  });

  it("carries the submission id so the parent flag can be stamped", () => {
    const plan = planAssetRetentionDeletes({
      now: NOW,
      assets: [
        asset({ id: "a", submission_id: "sub-9", created_at: agedDays(200) }),
      ],
    });

    expect(plan.expired[0]).toEqual({
      assetId: "a",
      submissionId: "sub-9",
      kind: "screenshot",
      storagePath: `${HUB}/screenshots/a.png`,
    });
  });

  it("skips an asset already stamped purged", () => {
    const plan = planAssetRetentionDeletes({
      now: NOW,
      assets: [
        asset({
          id: "a",
          created_at: agedDays(200),
          purged_at: agedDays(1),
        }),
      ],
    });
    expect(plan.expired).toEqual([]);
  });

  it("skips an asset with no path left", () => {
    const plan = planAssetRetentionDeletes({
      now: NOW,
      assets: [
        asset({ id: "a", created_at: agedDays(200), storage_path: null }),
      ],
    });
    expect(plan.expired).toEqual([]);
  });

  it("keeps media it cannot prove is expired", () => {
    const plan = planAssetRetentionDeletes({
      now: NOW,
      assets: [
        asset({ id: "bad-date", created_at: "not-a-date" }),
        asset({ id: "bad-kind", kind: "document", created_at: agedDays(3650) }),
        asset({ id: "proto", kind: "__proto__", created_at: agedDays(3650) }),
      ],
    });
    expect(plan.expired).toEqual([]);
    expect(plan.storagePathsToDelete).toEqual([]);
  });

  it("de-duplicates a path shared by two asset rows", () => {
    const shared = `${HUB}/screenshots/shared.png`;
    const plan = planAssetRetentionDeletes({
      now: NOW,
      assets: [
        asset({ id: "a", created_at: agedDays(200), storage_path: shared }),
        asset({ id: "b", created_at: agedDays(200), storage_path: shared }),
      ],
    });

    expect(plan.storagePathsToDelete).toEqual([shared]);
    expect(plan.expired).toHaveLength(2);
  });

  it("stamps every asset in one run with the same instant", () => {
    const plan = planAssetRetentionDeletes({
      now: NOW,
      assets: [
        asset({ id: "a", created_at: agedDays(200) }),
        asset({ id: "b", created_at: agedDays(200) }),
      ],
    });
    expect(plan.purgedAt).toBe(NOW.toISOString());
  });

  it("plans nothing for an empty page", () => {
    expect(planAssetRetentionDeletes({ now: NOW, assets: [] })).toEqual({
      storagePathsToDelete: [],
      expired: [],
      purgedAt: NOW.toISOString(),
    });
  });
});
