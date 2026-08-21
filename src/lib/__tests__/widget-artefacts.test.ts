import { describe, expect, it } from "vitest";
import {
  artefactState,
  mediaAssetProxyUrl,
  mediaProxyUrl,
  screenshotSrc,
  submissionArtefacts,
} from "../widget-artefacts";
import type { WidgetSubmission } from "../widget-types";

const SUBMISSION_ID = "11111111-2222-3333-4444-555555555555";

function submission(
  overrides: Partial<WidgetSubmission> = {}
): WidgetSubmission {
  return {
    id: SUBMISSION_ID,
    widget_config_id: "config",
    hub_id: "hub",
    title: "Broken checkout",
    description: null,
    type: "bug",
    screenshot_url: null,
    screenshot_storage_path: null,
    video_storage_path: null,
    replay_storage_path: null,
    media_purged_at: null,
    metadata: {
      url: "https://example.com",
      userAgent: "test",
      viewport: { width: 1280, height: 720 },
      timestamp: "2026-08-20T00:00:00.000Z",
      console: [],
      sentry: null,
      custom: {},
    },
    picks: [],
    screenshot_annotations: [],
    reporter_email: "someone@example.com",
    reporter_name: null,
    linear_issue_id: null,
    linear_issue_url: null,
    sync_status: "synced",
    sync_error: null,
    page_url: null,
    created_at: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("artefactState", () => {
  it("is present when a storage path exists", () => {
    expect(artefactState("hub/videos/a.webm", null)).toBe("present");
  });

  it("is purged when the path is gone and retention stamped the row", () => {
    expect(artefactState(null, "2026-08-20T00:00:00.000Z")).toBe("purged");
  });

  it("is absent when nothing was ever attached", () => {
    expect(artefactState(null, null)).toBe("absent");
  });

  it("still reports present when retention stamped the row but this path survived", () => {
    expect(artefactState("hub/videos/a.webm", "2026-08-20T00:00:00.000Z")).toBe(
      "present"
    );
  });
});

describe("mediaProxyUrl", () => {
  it("points at the proxy route, never a signed URL", () => {
    expect(mediaProxyUrl(SUBMISSION_ID, "replay")).toBe(
      `/api/widget/media/${SUBMISSION_ID}/replay`
    );
  });
});

describe("mediaAssetProxyUrl", () => {
  it("addresses one asset, under the static `asset` segment", () => {
    const assetId = "11111111-1111-4111-8111-111111111111";
    expect(mediaAssetProxyUrl(assetId)).toBe(
      `/api/widget/media/asset/${assetId}`
    );
  });
});

describe("screenshotSrc", () => {
  it("prefers the proxy when a storage path exists", () => {
    const src = screenshotSrc(
      submission({
        screenshot_storage_path: "hub/screenshots/a.png",
        screenshot_url: "https://legacy.example.com/a.png",
      })
    );
    expect(src).toBe(`/api/widget/media/${SUBMISSION_ID}/screenshot`);
  });

  it("falls back to the stored URL for rows that predate PULSE-324", () => {
    const src = screenshotSrc(
      submission({ screenshot_url: "https://legacy.example.com/a.png" })
    );
    expect(src).toBe("https://legacy.example.com/a.png");
  });

  it("is null when there is no screenshot at all", () => {
    expect(screenshotSrc(submission())).toBeNull();
  });
});

describe("submissionArtefacts", () => {
  it("reports nothing for a bare submission", () => {
    expect(submissionArtefacts(submission())).toEqual({
      screenshot: "absent",
      video: "absent",
      replay: "absent",
      pickCount: 0,
      annotationCount: 0,
      hasAny: false,
    });
  });

  it("counts picks and annotations", () => {
    const result = submissionArtefacts(
      submission({
        picks: [{ id: "p1" }, { id: "p2" }] as WidgetSubmission["picks"],
        screenshot_annotations: [
          { kind: "highlight", x: 0, y: 0, w: 10, h: 10 },
        ],
      })
    );
    expect(result.pickCount).toBe(2);
    expect(result.annotationCount).toBe(1);
    expect(result.hasAny).toBe(true);
  });

  it("marks every media artefact purged once retention has run", () => {
    const result = submissionArtefacts(
      submission({ media_purged_at: "2026-08-20T00:00:00.000Z" })
    );
    expect(result).toMatchObject({
      screenshot: "purged",
      video: "purged",
      replay: "purged",
      hasAny: true,
    });
  });

  it("treats a legacy screenshot_url as a present screenshot", () => {
    const result = submissionArtefacts(
      submission({ screenshot_url: "https://legacy.example.com/a.png" })
    );
    expect(result.screenshot).toBe("present");
    expect(result.hasAny).toBe(true);
  });

  it("defaults picks and annotations when the columns are missing", () => {
    const row = submission();
    delete (row as Partial<WidgetSubmission>).picks;
    delete (row as Partial<WidgetSubmission>).screenshot_annotations;
    const result = submissionArtefacts(row);
    expect(result.pickCount).toBe(0);
    expect(result.annotationCount).toBe(0);
  });
});
