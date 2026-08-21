import { describe, expect, it } from "vitest";
import {
  MAX_ASSETS_PER_SUBMISSION,
  WIDGET_ASSET_CAPS,
  assetCapMessage,
  assetsOfKind,
  contentTypeForStoragePath,
  countByKind,
  exceedsSizeCap,
  findAssetCapViolation,
  firstAssetOfKind,
  resolveSubmissionAssets,
  type LegacySubmissionMedia,
  type WidgetSubmissionAsset,
} from "@/lib/widget-assets";
import type { WidgetMediaKind } from "@/lib/widget-upload";

const HUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function legacy(
  overrides: Partial<LegacySubmissionMedia> = {}
): LegacySubmissionMedia {
  return {
    screenshot_storage_path: null,
    video_storage_path: null,
    replay_storage_path: null,
    media_purged_at: null,
    screenshot_annotations: [],
    ...overrides,
  };
}

function asset(
  overrides: Partial<WidgetSubmissionAsset> & { id: string }
): WidgetSubmissionAsset {
  const kind: WidgetMediaKind = overrides.kind ?? "screenshot";
  return {
    submission_id: SUB,
    kind,
    storage_path: `${HUB}/screenshots/${overrides.id}.png`,
    content_type: "image/png",
    size_bytes: null,
    width: null,
    height: null,
    duration_ms: null,
    annotations: [],
    position: 0,
    purged_at: null,
    created_at: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveSubmissionAssets", () => {
  it("prefers asset rows and orders them by position", () => {
    const resolved = resolveSubmissionAssets({
      assets: [
        asset({ id: "a3", position: 2 }),
        asset({ id: "a1", position: 0 }),
        asset({ id: "a2", position: 1 }),
      ],
      submission: legacy({
        screenshot_storage_path: `${HUB}/screenshots/legacy.png`,
      }),
    });

    expect(resolved.map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    // The legacy column is ignored once the kind has rows of its own.
    expect(resolved.map((a) => a.storagePath)).not.toContain(
      `${HUB}/screenshots/legacy.png`
    );
  });

  it("falls back to the legacy columns when there are no asset rows", () => {
    const resolved = resolveSubmissionAssets({
      assets: [],
      submission: legacy({
        screenshot_storage_path: `${HUB}/screenshots/shot.png`,
        video_storage_path: `${HUB}/videos/clip.webm`,
        screenshot_annotations: [{ kind: "highlight", x: 1, y: 2, w: 3, h: 4 }],
      }),
    });

    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({
      id: null,
      kind: "screenshot",
      storagePath: `${HUB}/screenshots/shot.png`,
      contentType: "image/png",
      position: 0,
    });
    // Submission-level annotations describe the one screenshot a legacy row
    // could carry, so they follow it through the fallback.
    expect(resolved[0].annotations).toEqual([
      { kind: "highlight", x: 1, y: 2, w: 3, h: 4 },
    ]);
    expect(resolved[1]).toMatchObject({
      id: null,
      kind: "video",
      contentType: "video/webm",
    });
  });

  it("falls back per kind, not all-or-nothing", () => {
    const resolved = resolveSubmissionAssets({
      assets: [asset({ id: "s1" })],
      submission: legacy({
        screenshot_storage_path: `${HUB}/screenshots/legacy.png`,
        video_storage_path: `${HUB}/videos/clip.mp4`,
      }),
    });

    expect(resolved.map((a) => [a.kind, a.id])).toEqual([
      ["screenshot", "s1"],
      ["video", null],
    ]);
  });

  it("treats a missing assets list the same as an empty one", () => {
    const submission = legacy({
      screenshot_storage_path: `${HUB}/screenshots/shot.png`,
    });
    expect(resolveSubmissionAssets({ submission })).toEqual(
      resolveSubmissionAssets({ assets: null, submission })
    );
  });

  it("returns nothing for a submission with neither rows nor paths", () => {
    expect(
      resolveSubmissionAssets({ assets: [], submission: legacy() })
    ).toEqual([]);
  });

  it("keeps purged assets in the list, flagged", () => {
    const resolved = resolveSubmissionAssets({
      assets: [asset({ id: "p1", purged_at: "2026-11-20T00:00:00.000Z" })],
      submission: legacy(),
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0].purgedAt).toBe("2026-11-20T00:00:00.000Z");
  });

  it("orders screenshots, then video, then replay", () => {
    const resolved = resolveSubmissionAssets({
      assets: [
        asset({ id: "r", kind: "replay", storage_path: `${HUB}/replays/r.json` }),
        asset({ id: "v", kind: "video", storage_path: `${HUB}/videos/v.webm` }),
        asset({ id: "s", kind: "screenshot" }),
      ],
      submission: legacy(),
    });

    expect(resolved.map((a) => a.kind)).toEqual([
      "screenshot",
      "video",
      "replay",
    ]);
  });

  it("breaks a position tie deterministically by id", () => {
    const rows = [
      asset({ id: "b", position: 0 }),
      asset({ id: "a", position: 0 }),
    ];
    const forwards = resolveSubmissionAssets({ assets: rows, submission: legacy() });
    const backwards = resolveSubmissionAssets({
      assets: [...rows].reverse(),
      submission: legacy(),
    });

    expect(forwards.map((a) => a.id)).toEqual(["a", "b"]);
    expect(backwards.map((a) => a.id)).toEqual(forwards.map((a) => a.id));
  });

  it("carries per-asset annotations off the row, not the submission", () => {
    const resolved = resolveSubmissionAssets({
      assets: [
        asset({
          id: "a1",
          position: 0,
          annotations: [{ kind: "hide", x: 5, y: 5, w: 5, h: 5 }],
        }),
        asset({ id: "a2", position: 1 }),
      ],
      submission: legacy({
        screenshot_annotations: [{ kind: "highlight", x: 0, y: 0, w: 1, h: 1 }],
      }),
    });

    expect(resolved[0].annotations).toEqual([
      { kind: "hide", x: 5, y: 5, w: 5, h: 5 },
    ]);
    expect(resolved[1].annotations).toEqual([]);
  });

  it("normalises a null annotations column to an empty list", () => {
    const resolved = resolveSubmissionAssets({
      assets: [asset({ id: "a1", annotations: null })],
      submission: legacy(),
    });
    expect(resolved[0].annotations).toEqual([]);
  });
});

describe("firstAssetOfKind", () => {
  it("resolves the lowest position, which is what the legacy URL points at", () => {
    const resolved = resolveSubmissionAssets({
      assets: [
        asset({ id: "second", position: 1 }),
        asset({ id: "first", position: 0 }),
      ],
      submission: legacy(),
    });

    expect(firstAssetOfKind(resolved, "screenshot")?.id).toBe("first");
  });

  it("returns the purged first asset rather than skipping to a live one", () => {
    const resolved = resolveSubmissionAssets({
      assets: [
        asset({ id: "gone", position: 0, purged_at: "2026-11-20T00:00:00.000Z" }),
        asset({ id: "live", position: 1 }),
      ],
      submission: legacy(),
    });

    expect(firstAssetOfKind(resolved, "screenshot")?.id).toBe("gone");
  });

  it("is null for a kind with nothing attached", () => {
    const resolved = resolveSubmissionAssets({
      assets: [asset({ id: "s" })],
      submission: legacy(),
    });
    expect(firstAssetOfKind(resolved, "video")).toBeNull();
    expect(assetsOfKind(resolved, "video")).toEqual([]);
  });
});

describe("contentTypeForStoragePath", () => {
  it.each([
    [`${HUB}/screenshots/a.png`, "screenshot", "image/png"],
    [`${HUB}/screenshots/a.jpg`, "screenshot", "image/jpeg"],
    [`${HUB}/screenshots/a.jpeg`, "screenshot", "image/jpeg"],
    [`${HUB}/screenshots/A.PNG`, "screenshot", "image/png"],
    [`${HUB}/videos/a.webm`, "video", "video/webm"],
    [`${HUB}/videos/a.mp4`, "video", "video/mp4"],
    [`${HUB}/replays/a.json`, "replay", "application/json"],
  ])("maps %s to %s", (path, kind, expected) => {
    expect(contentTypeForStoragePath(path, kind as WidgetMediaKind)).toBe(
      expected
    );
  });

  it("is null for an extension the signer never mints", () => {
    expect(
      contentTypeForStoragePath(`${HUB}/screenshots/a.svg`, "screenshot")
    ).toBeNull();
  });
});

describe("caps", () => {
  it("caps at 6 screenshots, 1 video, 1 replay", () => {
    expect(WIDGET_ASSET_CAPS).toEqual({ screenshot: 6, video: 1, replay: 1 });
    expect(MAX_ASSETS_PER_SUBMISSION).toBe(8);
  });

  it("counts every kind, including the absent ones", () => {
    expect(countByKind([{ kind: "screenshot" }, { kind: "screenshot" }])).toEqual(
      { screenshot: 2, video: 0, replay: 0 }
    );
  });

  it("passes a submission at exactly the cap", () => {
    const atCap = [
      ...Array.from({ length: 6 }, () => ({ kind: "screenshot" as const })),
      { kind: "video" as const },
      { kind: "replay" as const },
    ];
    expect(findAssetCapViolation(atCap)).toBeNull();
  });

  it("rejects a seventh screenshot", () => {
    const violation = findAssetCapViolation(
      Array.from({ length: 7 }, () => ({ kind: "screenshot" as const }))
    );
    expect(violation).toEqual({ kind: "screenshot", cap: 6, count: 7 });
    expect(assetCapMessage(violation!)).toBe(
      "Too many screenshot attachments: 7 submitted, 6 allowed per submission"
    );
  });

  it("rejects a second video and a second replay", () => {
    expect(
      findAssetCapViolation([{ kind: "video" }, { kind: "video" }])
    ).toEqual({ kind: "video", cap: 1, count: 2 });
    expect(
      findAssetCapViolation([{ kind: "replay" }, { kind: "replay" }])
    ).toEqual({ kind: "replay", cap: 1, count: 2 });
  });

  it("reports the screenshot cap first when a payload breaks two", () => {
    const violation = findAssetCapViolation([
      ...Array.from({ length: 7 }, () => ({ kind: "screenshot" as const })),
      { kind: "video" as const },
      { kind: "video" as const },
    ]);
    expect(violation?.kind).toBe("screenshot");
  });
});

describe("exceedsSizeCap", () => {
  it("keeps the per-kind byte ceilings from the upload signer", () => {
    expect(exceedsSizeCap("screenshot", 10 * 1024 * 1024)).toBe(false);
    expect(exceedsSizeCap("screenshot", 10 * 1024 * 1024 + 1)).toBe(true);
    expect(exceedsSizeCap("video", 100 * 1024 * 1024 + 1)).toBe(true);
    expect(exceedsSizeCap("replay", 20 * 1024 * 1024 + 1)).toBe(true);
  });

  it("does not reject an asset that reports no size", () => {
    expect(exceedsSizeCap("screenshot", null)).toBe(false);
    expect(exceedsSizeCap("screenshot", undefined)).toBe(false);
  });
});
