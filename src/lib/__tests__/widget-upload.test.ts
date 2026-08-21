import { describe, expect, it, vi } from "vitest";

vi.mock("../supabase", () => ({ supabaseAdmin: { storage: {} } }));

import {
  STORAGE_PATH_PATTERN,
  baseContentType,
  WIDGET_MEDIA_MAX_BYTES,
  deleteWidgetObjects,
  signWidgetRead,
  signWidgetUpload,
  type SignWidgetUploadInput,
  type WidgetStorageClient,
} from "../widget-upload";

const HUB = "11111111-1111-1111-1111-111111111111";
const STORAGE_BASE = "https://proj.supabase.co/storage/v1";

type Calls = {
  bucket?: string;
  uploadPath?: string;
  readPath?: string;
  readExpiresIn?: number;
  removed?: string[];
};

function fakeStorage(
  overrides: {
    uploadError?: string;
    readError?: string;
    removeError?: string;
  } = {}
): { storage: WidgetStorageClient; calls: Calls } {
  const calls: Calls = {};
  const storage: WidgetStorageClient = {
    from(bucket) {
      calls.bucket = bucket;
      return {
        async createSignedUploadUrl(path) {
          calls.uploadPath = path;
          if (overrides.uploadError) {
            return { data: null, error: { message: overrides.uploadError } };
          }
          return {
            data: {
              signedUrl: `${STORAGE_BASE}/object/upload/sign/${bucket}/${path}?token=tok123`,
              token: "tok123",
              path,
            },
            error: null,
          };
        },
        async createSignedUrl(path, expiresIn) {
          calls.readPath = path;
          calls.readExpiresIn = expiresIn;
          if (overrides.readError) {
            return { data: null, error: { message: overrides.readError } };
          }
          return {
            data: {
              signedUrl: `${STORAGE_BASE}/object/sign/${bucket}/${path}?token=read456`,
            },
            error: null,
          };
        },
        async remove(paths) {
          calls.removed = paths;
          if (overrides.removeError) {
            return { data: null, error: { message: overrides.removeError } };
          }
          return { data: [], error: null };
        },
      };
    },
  };
  return { storage, calls };
}

function baseInput(
  storage: WidgetStorageClient,
  overrides: Partial<SignWidgetUploadInput> = {}
): SignWidgetUploadInput {
  return {
    hubId: HUB,
    kind: "screenshot",
    contentType: "image/png",
    generateId: () => "abcd-uuid",
    now: new Date("2026-08-20T12:00:00.000Z"),
    storage,
    ...overrides,
  };
}

describe("signWidgetUpload", () => {
  it("returns the signed upload payload for a valid input", async () => {
    const { storage, calls } = fakeStorage();
    const result = await signWidgetUpload(baseInput(storage));

    expect(calls.bucket).toBe("widget-media");
    expect(result.storagePath).toBe(`${HUB}/screenshots/abcd-uuid.png`);
    expect(calls.uploadPath).toBe(result.storagePath);
    expect(result.uploadUrl).toBe(
      `${STORAGE_BASE}/object/upload/sign/widget-media/${HUB}/screenshots/abcd-uuid.png?token=tok123`
    );
    expect(result.token).toBe("tok123");
    expect(result.bucket).toBe("widget-media");
    expect(result.resumableEndpoint).toBe(`${STORAGE_BASE}/upload/resumable`);
  });

  it("maps each kind to its plural folder segment", async () => {
    const { storage } = fakeStorage();
    const screenshot = await signWidgetUpload(baseInput(storage));
    const video = await signWidgetUpload(
      baseInput(storage, { kind: "video", contentType: "video/webm" })
    );
    const replay = await signWidgetUpload(
      baseInput(storage, { kind: "replay", contentType: "application/json" })
    );

    expect(screenshot.storagePath).toContain("/screenshots/");
    expect(video.storagePath).toContain("/videos/");
    expect(replay.storagePath).toContain("/replays/");
  });

  it("maps allowed content types to file extensions (incl. mp4 and json)", async () => {
    const { storage } = fakeStorage();
    const cases: Array<[SignWidgetUploadInput["kind"], string, string]> = [
      ["screenshot", "image/png", "png"],
      ["screenshot", "image/jpeg", "jpg"],
      ["video", "video/webm", "webm"],
      ["video", "video/mp4", "mp4"],
      ["replay", "application/json", "json"],
    ];
    for (const [kind, contentType, ext] of cases) {
      const result = await signWidgetUpload(
        baseInput(storage, { kind, contentType })
      );
      expect(result.storagePath.endsWith(`.${ext}`)).toBe(true);
    }
  });

  // Regression, found by driving the built widget against a live upload route:
  // MediaRecorder reports "video/webm;codecs=vp9" and the widget forwards it
  // verbatim, but the allowlist is keyed on the base type. Every test here used
  // a bare "video/webm", so both sides passed and real video upload 400'd.
  it("accepts the parameterised content types MediaRecorder actually emits", async () => {
    const { storage } = fakeStorage();
    const cases: Array<[string, string]> = [
      ["video/webm;codecs=vp9", "webm"],
      ["video/webm;codecs=vp8", "webm"],
      ["video/webm; codecs=\"vp9,opus\"", "webm"],
      ["video/mp4;codecs=avc1", "mp4"],
      ["VIDEO/WEBM;CODECS=VP9", "webm"],
    ];
    for (const [contentType, ext] of cases) {
      const result = await signWidgetUpload(
        baseInput(storage, { kind: "video", contentType })
      );
      expect(result.storagePath.endsWith(`.${ext}`)).toBe(true);
      // the codec parameter must never leak into the object key
      expect(result.storagePath).not.toContain(";");
      expect(result.storagePath).not.toContain("codecs");
    }
  });

  it("still rejects a parameterised type that is not allowed for the kind", async () => {
    const { storage } = fakeStorage();
    await expect(
      signWidgetUpload(
        baseInput(storage, { kind: "screenshot", contentType: "video/webm;codecs=vp9" })
      )
    ).rejects.toThrow(/content type/i);
  });

  it("rejects an unknown content type", async () => {
    const { storage } = fakeStorage();
    await expect(
      signWidgetUpload(baseInput(storage, { contentType: "application/x-evil" }))
    ).rejects.toThrow(/content type/i);
  });

  it("rejects a content type that is allowed for another kind", async () => {
    const { storage, calls } = fakeStorage();
    await expect(
      signWidgetUpload(
        baseInput(storage, { kind: "screenshot", contentType: "video/webm" })
      )
    ).rejects.toThrow(/content type/i);
    await expect(
      signWidgetUpload(
        baseInput(storage, { kind: "replay", contentType: "image/png" })
      )
    ).rejects.toThrow(/content type/i);
    expect(calls.uploadPath).toBeUndefined();
  });

  it("rejects an unknown kind before touching storage", async () => {
    const { storage, calls } = fakeStorage();
    await expect(
      signWidgetUpload(
        baseInput(storage, {
          kind: "document" as unknown as SignWidgetUploadInput["kind"],
        })
      )
    ).rejects.toThrow(/kind/i);
    expect(calls.uploadPath).toBeUndefined();
  });

  it("rejects a hubId that could path-traverse out of its prefix", async () => {
    const { storage, calls } = fakeStorage();
    const malicious = [
      "../../other-hub",
      "foo/bar",
      "..",
      `/${HUB}`,
      `${HUB}/../evil`,
      "",
    ];
    for (const hubId of malicious) {
      await expect(
        signWidgetUpload(baseInput(storage, { hubId }))
      ).rejects.toThrow(/hub id/i);
    }
    expect(calls.uploadPath).toBeUndefined();
  });

  it("accepts a well-formed UUID hubId and scopes the key under it", async () => {
    const { storage } = fakeStorage();
    const other = "22222222-2222-2222-2222-222222222222";
    const result = await signWidgetUpload(baseInput(storage, { hubId: other }));
    expect(result.storagePath.startsWith(`${other}/`)).toBe(true);
    expect(STORAGE_PATH_PATTERN.test(result.storagePath)).toBe(true);
  });

  it("expires 5 minutes from now", async () => {
    const { storage } = fakeStorage();
    const result = await signWidgetUpload(baseInput(storage));
    expect(result.expiresAt).toBe("2026-08-20T12:05:00.000Z");
  });

  it("uses a random UUID when no generateId is provided", async () => {
    const { storage } = fakeStorage();
    const result = await signWidgetUpload(
      baseInput(storage, { generateId: undefined })
    );
    expect(result.storagePath).toMatch(
      new RegExp(
        `^${HUB}/screenshots/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png$`
      )
    );
  });

  it("propagates storage errors", async () => {
    const { storage } = fakeStorage({ uploadError: "bucket missing" });
    await expect(signWidgetUpload(baseInput(storage))).rejects.toThrow(
      /bucket missing/
    );
  });
});

describe("signWidgetRead", () => {
  const storagePath = `${HUB}/screenshots/abcd.png`;
  const now = new Date("2026-08-20T12:00:00.000Z");

  it("returns a signed read URL with a 10-minute default expiry", async () => {
    const { storage, calls } = fakeStorage();
    const result = await signWidgetRead({ storagePath, now, storage });

    expect(calls.bucket).toBe("widget-media");
    expect(calls.readPath).toBe(storagePath);
    expect(calls.readExpiresIn).toBe(600);
    expect(result.url).toBe(
      `${STORAGE_BASE}/object/sign/widget-media/${storagePath}?token=read456`
    );
    expect(result.expiresAt).toBe("2026-08-20T12:10:00.000Z");
  });

  it("honours an explicit expiresInSeconds", async () => {
    const { storage, calls } = fakeStorage();
    const result = await signWidgetRead({
      storagePath,
      now,
      storage,
      expiresInSeconds: 120,
    });
    expect(calls.readExpiresIn).toBe(120);
    expect(result.expiresAt).toBe("2026-08-20T12:02:00.000Z");
  });

  it("rejects a storage path that could traverse out of its prefix", async () => {
    const { storage, calls } = fakeStorage();
    const malicious = [
      "../../other-hub/screenshots/x.png",
      `/${HUB}/screenshots/x.png`,
      `${HUB}/screenshots/../../../etc/passwd`,
      "not-a-uuid/screenshots/x.png",
      `${HUB}/secrets/x.png`,
      `${HUB}/screenshots/`,
      `${HUB}/screenshots/a/b.png`,
      "",
    ];
    for (const path of malicious) {
      await expect(
        signWidgetRead({ storagePath: path, storage })
      ).rejects.toThrow(/storage path/i);
    }
    expect(calls.readPath).toBeUndefined();
  });

  it("propagates storage errors", async () => {
    const { storage } = fakeStorage({ readError: "object not found" });
    await expect(signWidgetRead({ storagePath, storage })).rejects.toThrow(
      /object not found/
    );
  });
});

describe("deleteWidgetObjects", () => {
  const paths = [`${HUB}/screenshots/a.png`, `${HUB}/videos/b.webm`];

  it("removes the given paths from the bucket", async () => {
    const { storage, calls } = fakeStorage();
    await deleteWidgetObjects(paths, storage);
    expect(calls.bucket).toBe("widget-media");
    expect(calls.removed).toEqual(paths);
  });

  it("is a no-op for an empty list", async () => {
    const { storage, calls } = fakeStorage();
    await deleteWidgetObjects([], storage);
    expect(calls.removed).toBeUndefined();
  });

  it("rejects the whole batch if any path is outside the pattern", async () => {
    const { storage, calls } = fakeStorage();
    await expect(
      deleteWidgetObjects([...paths, `${HUB}/screenshots/../x`], storage)
    ).rejects.toThrow(/storage path/i);
    expect(calls.removed).toBeUndefined();
  });

  it("propagates storage errors", async () => {
    const { storage } = fakeStorage({ removeError: "boom" });
    await expect(deleteWidgetObjects(paths, storage)).rejects.toThrow(/boom/);
  });
});

describe("WIDGET_MEDIA_MAX_BYTES", () => {
  it("caps screenshot 10 MB, video 100 MB, replay 20 MB", () => {
    expect(WIDGET_MEDIA_MAX_BYTES.screenshot).toBe(10 * 1024 * 1024);
    expect(WIDGET_MEDIA_MAX_BYTES.video).toBe(100 * 1024 * 1024);
    expect(WIDGET_MEDIA_MAX_BYTES.replay).toBe(20 * 1024 * 1024);
  });
});

// PULSE-400: with a microphone track the widget negotiates an Opus/AAC-paired
// type, so these exact strings now reach the upload route. Kept explicit rather
// than imported from the widget package — the point is that the SERVER accepts
// what the widget emits, and a shared constant would let both sides drift
// together without a test noticing.
describe("voice-over content types (PULSE-400)", () => {
  it("accepts the Opus- and AAC-paired types a voice-over recording produces", async () => {
    const { storage } = fakeStorage();
    const cases: Array<[string, string]> = [
      ["video/webm;codecs=vp9,opus", "webm"],
      ["video/webm;codecs=vp8,opus", "webm"],
      ["video/mp4;codecs=avc1,mp4a.40.2", "mp4"],
    ];
    for (const [contentType, ext] of cases) {
      const result = await signWidgetUpload(
        baseInput(storage, { kind: "video", contentType })
      );
      expect(baseContentType(contentType)).toMatch(/^video\/(webm|mp4)$/);
      expect(result.storagePath.endsWith(`.${ext}`)).toBe(true);
      // A narrated recording is media like any other: same private bucket,
      // same per-hub prefix, no codec parameter anywhere in the key.
      expect(result.storagePath).toContain("/videos/");
      expect(result.storagePath).not.toContain("opus");
      expect(result.storagePath).not.toContain(",");
    }
  });

  it("strips every parameter, not just the first", () => {
    expect(baseContentType('video/webm; codecs="vp9,opus"; foo=bar')).toBe("video/webm");
  });
});
