import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabaseAdmin: { from: () => ({}) } }));
vi.mock("@sentry/nextjs", () => ({
  captureCheckIn: vi.fn(() => "check-in-id"),
  captureException: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { GET } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/widget-retention", () => {
  it("401s without the cron secret configured", async () => {
    const res = await GET(
      new Request("https://pulse.test/api/cron/widget-retention", {
        headers: { authorization: "Bearer anything" },
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("401s on a wrong bearer token", async () => {
    process.env.CRON_SECRET = "right";
    const res = await GET(
      new Request("https://pulse.test/api/cron/widget-retention", {
        headers: { authorization: "Bearer wrong" },
      }) as never
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("401s with no authorization header at all", async () => {
    process.env.CRON_SECRET = "right";
    const res = await GET(
      new Request("https://pulse.test/api/cron/widget-retention") as never
    );
    expect(res.status).toBe(401);
  });

  it("does not open a Sentry check-in for an unauthorized call", async () => {
    process.env.CRON_SECRET = "right";
    await GET(
      new Request("https://pulse.test/api/cron/widget-retention") as never
    );
    expect(Sentry.captureCheckIn).not.toHaveBeenCalled();
  });
});
