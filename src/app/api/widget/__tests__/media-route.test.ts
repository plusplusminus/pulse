import { beforeEach, describe, expect, it, vi } from "vitest";

const HUB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ASSET_1 = "11111111-1111-4111-8111-111111111111";
const ASSET_2 = "22222222-2222-4222-8222-222222222222";
const ASSET_3 = "33333333-3333-4333-8333-333333333333";

type Row = {
  id: string;
  hub_id: string;
  screenshot_storage_path: string | null;
  video_storage_path: string | null;
  replay_storage_path: string | null;
  screenshot_annotations: unknown[];
  media_purged_at: string | null;
};

type AssetRow = {
  id: string;
  submission_id: string;
  kind: string;
  storage_path: string;
  content_type: string;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  annotations: unknown[];
  position: number;
  purged_at: string | null;
  created_at: string;
};

const db: {
  submission: Row | null;
  assets: AssetRow[];
  hubSlug: string | null;
  assetError: { message: string } | null;
} = {
  submission: null,
  assets: [],
  hubSlug: null,
  assetError: null,
};
const signed: Array<{ path: string; expiresIn: number }> = [];

/**
 * Enough of the PostgREST builder for both proxy routes: `.eq()` chains that
 * end in `.single()` (submission, hub, one asset) and one that is awaited
 * directly after `.order()` (a submission's assets of one kind).
 */
vi.mock("@/lib/supabase", () => {
  type Filters = Record<string, unknown>;

  function singleFor(table: string, filters: Filters) {
    if (table === "widget_submissions") {
      const match =
        db.submission && db.submission.id === filters.id ? db.submission : null;
      return { data: match, error: null };
    }
    if (table === "client_hubs") {
      return { data: db.hubSlug ? { slug: db.hubSlug } : null, error: null };
    }
    if (table === "widget_submission_assets") {
      if (db.assetError) return { data: null, error: db.assetError };
      return {
        data: db.assets.find((a) => a.id === filters.id) ?? null,
        error: null,
      };
    }
    return { data: null, error: null };
  }

  function listFor(table: string, filters: Filters) {
    if (table !== "widget_submission_assets") return { data: [], error: null };
    if (db.assetError) return { data: null, error: db.assetError };
    const rows = db.assets
      .filter(
        (a) =>
          a.submission_id === filters.submission_id &&
          (filters.kind === undefined || a.kind === filters.kind)
      )
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    return { data: rows, error: null };
  }

  function builder(table: string) {
    const filters: Filters = {};
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
      order: () => chain,
      single: async () => singleFor(table, filters),
      then: <T>(
        onFulfilled: (value: ReturnType<typeof listFor>) => T
      ): Promise<T> => Promise.resolve(listFor(table, filters)).then(onFulfilled),
    };
    return chain;
  }

  return {
    supabaseAdmin: {
      from: (table: string) => builder(table),
      storage: {
        from: () => ({
          createSignedUrl: async (path: string, expiresIn: number) => {
            signed.push({ path, expiresIn });
            return {
              data: {
                signedUrl: `https://proj.supabase.co/storage/v1/object/sign/widget-media/${path}?token=read`,
              },
              error: null,
            };
          },
        }),
      },
    },
  };
});

vi.mock("@/lib/hub-auth", () => ({
  withHubAuth: vi.fn(),
}));

import { withHubAuth } from "@/lib/hub-auth";
import { GET } from "../media/[submissionId]/[kind]/route";
import { GET as GET_ASSET } from "../media/asset/[assetId]/route";

const mockedAuth = vi.mocked(withHubAuth);

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: SUB_ID,
    hub_id: HUB_A,
    screenshot_storage_path: `${HUB_A}/screenshots/shot.png`,
    video_storage_path: null,
    replay_storage_path: null,
    screenshot_annotations: [],
    media_purged_at: null,
    ...overrides,
  };
}

function assetRow(overrides: Partial<AssetRow> & { id: string }): AssetRow {
  return {
    submission_id: SUB_ID,
    kind: "screenshot",
    storage_path: `${HUB_A}/screenshots/${overrides.id}.png`,
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

function get(submissionId = SUB_ID, kind = "screenshot") {
  return GET(
    new Request(`https://pulse.test/api/widget/media/${submissionId}/${kind}`),
    { params: Promise.resolve({ submissionId, kind }) }
  );
}

function getAsset(assetId = ASSET_1) {
  return GET_ASSET(
    new Request(`https://pulse.test/api/widget/media/asset/${assetId}`),
    { params: Promise.resolve({ assetId }) }
  );
}

function memberOf(hubId: string, role: "admin" | "default" | "view_only" = "default") {
  mockedAuth.mockResolvedValue({
    user: { id: "u1", email: "u@example.com" } as never,
    hubId,
    role,
  });
}

beforeEach(() => {
  db.submission = row();
  db.assets = [];
  db.hubSlug = "acme";
  db.assetError = null;
  signed.length = 0;
  mockedAuth.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("GET /api/widget/media/:submissionId/:kind", () => {
  it("302s a hub member to a 10-minute signed read URL, uncached", async () => {
    memberOf(HUB_A);
    const res = await get();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `https://proj.supabase.co/storage/v1/object/sign/widget-media/${HUB_A}/screenshots/shot.png?token=read`
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(signed).toEqual([
      { path: `${HUB_A}/screenshots/shot.png`, expiresIn: 600 },
    ]);
    expect(mockedAuth).toHaveBeenCalledWith(HUB_A);
  });

  it("302s a PPM admin (synthetic admin role from withHubAuth)", async () => {
    memberOf(HUB_A, "admin");
    const res = await get();
    expect(res.status).toBe(302);
    expect(signed).toHaveLength(1);
  });

  it("picks the column for the requested kind", async () => {
    db.submission = row({
      video_storage_path: `${HUB_A}/videos/clip.webm`,
      replay_storage_path: `${HUB_A}/replays/r.json`,
    });
    memberOf(HUB_A);

    await get(SUB_ID, "video");
    await get(SUB_ID, "replay");

    expect(signed.map((s) => s.path)).toEqual([
      `${HUB_A}/videos/clip.webm`,
      `${HUB_A}/replays/r.json`,
    ]);
  });

  it("redirects an unauthenticated viewer to the hub login, uncached", async () => {
    mockedAuth.mockResolvedValue({ error: "Unauthorized", status: 401 });
    const res = await get();

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://pulse.test/hub/acme/login");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(signed).toEqual([]);
  });

  it("404s a member of another hub without signing anything", async () => {
    mockedAuth.mockResolvedValue({ error: "Not a member of this hub", status: 403 });
    const res = await get();
    expect(res.status).toBe(404);
    expect(signed).toEqual([]);
  });

  it("404s an unknown submission before any auth lookup", async () => {
    db.submission = null;
    const res = await get();
    expect(res.status).toBe(404);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("404s an unknown kind or malformed id without touching the database", async () => {
    memberOf(HUB_A);
    expect((await get(SUB_ID, "document")).status).toBe(404);
    expect((await get("not-a-uuid", "screenshot")).status).toBe(404);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("410s when retention purged the media", async () => {
    db.submission = row({
      screenshot_storage_path: null,
      media_purged_at: "2026-09-20T00:00:00.000Z",
    });
    memberOf(HUB_A);
    const res = await get();
    expect(res.status).toBe(410);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(signed).toEqual([]);
  });

  it("404s a kind the submission never had (not purged)", async () => {
    memberOf(HUB_A);
    const res = await get(SUB_ID, "video");
    expect(res.status).toBe(404);
    expect(signed).toEqual([]);
  });
});

/**
 * The regression the whole dual-read design exists to protect: media URLs of
 * the `:submissionId/:kind` shape are already written into Linear issue bodies
 * in the workspace. Every one of them must keep resolving.
 */
describe("GET /api/widget/media/:submissionId/:kind (legacy URL regression, PULSE-403)", () => {
  it("still resolves for a submission that has ONLY legacy columns", async () => {
    db.assets = [];
    db.submission = row({ screenshot_storage_path: `${HUB_A}/screenshots/old.png` });
    memberOf(HUB_A);

    const res = await get();

    expect(res.status).toBe(302);
    expect(signed).toEqual([
      { path: `${HUB_A}/screenshots/old.png`, expiresIn: 600 },
    ]);
  });

  it("resolves to the FIRST asset by position once assets exist", async () => {
    db.assets = [
      assetRow({ id: ASSET_3, position: 2 }),
      assetRow({ id: ASSET_1, position: 0 }),
      assetRow({ id: ASSET_2, position: 1 }),
    ];
    memberOf(HUB_A);

    const res = await get();

    expect(res.status).toBe(302);
    expect(signed).toEqual([
      { path: `${HUB_A}/screenshots/${ASSET_1}.png`, expiresIn: 600 },
    ]);
  });

  it("prefers the asset row over a stale legacy column", async () => {
    db.assets = [
      assetRow({ id: ASSET_1, position: 0, storage_path: `${HUB_A}/screenshots/new.png` }),
    ];
    db.submission = row({ screenshot_storage_path: `${HUB_A}/screenshots/stale.png` });
    memberOf(HUB_A);

    await get();

    expect(signed[0].path).toBe(`${HUB_A}/screenshots/new.png`);
  });

  it("falls back per kind: assets for screenshots, column for video", async () => {
    db.assets = [assetRow({ id: ASSET_1, position: 0 })];
    db.submission = row({ video_storage_path: `${HUB_A}/videos/clip.webm` });
    memberOf(HUB_A);

    expect((await get(SUB_ID, "screenshot")).status).toBe(302);
    expect((await get(SUB_ID, "video")).status).toBe(302);
    expect(signed.map((s) => s.path)).toEqual([
      `${HUB_A}/screenshots/${ASSET_1}.png`,
      `${HUB_A}/videos/clip.webm`,
    ]);
  });

  it("410s when the first asset was purged, without skipping to a live one", async () => {
    db.assets = [
      assetRow({ id: ASSET_1, position: 0, purged_at: "2026-11-20T00:00:00.000Z" }),
      assetRow({ id: ASSET_2, position: 1 }),
    ];
    db.submission = row({ screenshot_storage_path: null });
    memberOf(HUB_A);

    const res = await get();

    expect(res.status).toBe(410);
    expect(signed).toEqual([]);
  });

  it("keeps serving the legacy column when the asset lookup itself fails", async () => {
    db.assetError = { message: "relation does not exist" };
    memberOf(HUB_A);

    const res = await get();

    expect(res.status).toBe(302);
    expect(signed).toEqual([
      { path: `${HUB_A}/screenshots/shot.png`, expiresIn: 600 },
    ]);
  });

  it("still authorises before answering, assets or not", async () => {
    db.assets = [assetRow({ id: ASSET_1 })];
    mockedAuth.mockResolvedValue({ error: "Not a member of this hub", status: 403 });

    expect((await get()).status).toBe(404);
    expect(signed).toEqual([]);
  });
});

describe("GET /api/widget/media/asset/:assetId (PULSE-403)", () => {
  it("302s a hub member to a signed URL for that exact asset", async () => {
    db.assets = [
      assetRow({ id: ASSET_1, position: 0 }),
      assetRow({ id: ASSET_2, position: 1 }),
    ];
    memberOf(HUB_A);

    const res = await getAsset(ASSET_2);

    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(signed).toEqual([
      { path: `${HUB_A}/screenshots/${ASSET_2}.png`, expiresIn: 600 },
    ]);
  });

  it("reaches an asset the legacy URL shape cannot name", async () => {
    db.assets = [
      assetRow({ id: ASSET_1, position: 0 }),
      assetRow({ id: ASSET_2, position: 1 }),
      assetRow({ id: ASSET_3, position: 2 }),
    ];
    memberOf(HUB_A);

    await getAsset(ASSET_3);

    expect(signed[0].path).toBe(`${HUB_A}/screenshots/${ASSET_3}.png`);
  });

  it("404s a malformed id without touching the database", async () => {
    memberOf(HUB_A);
    const res = await getAsset("not-a-uuid");
    expect(res.status).toBe(404);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("404s an unknown asset before any auth lookup", async () => {
    db.assets = [];
    const res = await getAsset(ASSET_1);
    expect(res.status).toBe(404);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("404s an asset whose submission has gone", async () => {
    db.assets = [assetRow({ id: ASSET_1 })];
    db.submission = null;
    const res = await getAsset(ASSET_1);
    expect(res.status).toBe(404);
    expect(mockedAuth).not.toHaveBeenCalled();
  });

  it("410s a purged asset", async () => {
    db.assets = [
      assetRow({ id: ASSET_1, purged_at: "2026-11-20T00:00:00.000Z" }),
    ];
    memberOf(HUB_A);

    const res = await getAsset(ASSET_1);

    expect(res.status).toBe(410);
    expect(signed).toEqual([]);
  });

  it("404s a member of another hub, and never reveals the purge state", async () => {
    db.assets = [
      assetRow({ id: ASSET_1, purged_at: "2026-11-20T00:00:00.000Z" }),
    ];
    mockedAuth.mockResolvedValue({ error: "Not a member of this hub", status: 403 });

    const res = await getAsset(ASSET_1);

    expect(res.status).toBe(404);
    expect(signed).toEqual([]);
  });

  it("redirects an unauthenticated viewer to the hub login", async () => {
    db.assets = [assetRow({ id: ASSET_1 })];
    mockedAuth.mockResolvedValue({ error: "Unauthorized", status: 401 });

    const res = await getAsset(ASSET_1);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://pulse.test/hub/acme/login");
    expect(signed).toEqual([]);
  });
});
