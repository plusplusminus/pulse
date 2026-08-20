import { beforeEach, describe, expect, it, vi } from "vitest";

const HUB_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = {
  id: string;
  hub_id: string;
  screenshot_storage_path: string | null;
  video_storage_path: string | null;
  replay_storage_path: string | null;
  media_purged_at: string | null;
};

const db: { submission: Row | null; hubSlug: string | null } = {
  submission: null,
  hubSlug: null,
};
const signed: Array<{ path: string; expiresIn: number }> = [];

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (table === "widget_submissions") {
              return { data: db.submission, error: null };
            }
            if (table === "client_hubs") {
              return {
                data: db.hubSlug ? { slug: db.hubSlug } : null,
                error: null,
              };
            }
            return { data: null, error: null };
          },
        }),
      }),
    }),
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
}));

vi.mock("@/lib/hub-auth", () => ({
  withHubAuth: vi.fn(),
}));

import { withHubAuth } from "@/lib/hub-auth";
import { GET } from "../media/[submissionId]/[kind]/route";

const mockedAuth = vi.mocked(withHubAuth);

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: SUB_ID,
    hub_id: HUB_A,
    screenshot_storage_path: `${HUB_A}/screenshots/shot.png`,
    video_storage_path: null,
    replay_storage_path: null,
    media_purged_at: null,
    ...overrides,
  };
}

function get(submissionId = SUB_ID, kind = "screenshot") {
  return GET(
    new Request(`https://pulse.test/api/widget/media/${submissionId}/${kind}`),
    { params: Promise.resolve({ submissionId, kind }) }
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
  db.hubSlug = "acme";
  signed.length = 0;
  mockedAuth.mockReset();
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
