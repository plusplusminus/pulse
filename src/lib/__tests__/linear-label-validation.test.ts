import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the workspace token before importing the module under test so we
// don't need real env wiring inside vitest.
vi.mock("../workspace", () => ({
  getWorkspaceToken: vi.fn(async () => "Bearer test-token"),
}));

import { filterToAllowedLabelIds } from "../linear-label-validation";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockLinearLabels(ids: string[]) {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: { team: { labels: { nodes: ids.map((id) => ({ id })) } } },
      }),
      { status: 200 }
    )
  );
}

describe("filterToAllowedLabelIds", () => {
  it("returns empty result for empty input without hitting Linear", async () => {
    const result = await filterToAllowedLabelIds("team-1", []);
    expect(result).toEqual({ allowed: [], dropped: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps IDs the team recognises and drops the rest", async () => {
    mockLinearLabels(["a", "b", "c"]);
    const result = await filterToAllowedLabelIds("team-1", ["a", "x", "b", "y"]);
    expect(result.allowed).toEqual(["a", "b"]);
    expect(result.dropped).toEqual(["x", "y"]);
  });

  it("preserves request order in the allowed array", async () => {
    mockLinearLabels(["a", "b", "c"]);
    const result = await filterToAllowedLabelIds("team-1", ["c", "b", "a"]);
    expect(result.allowed).toEqual(["c", "b", "a"]);
  });

  it("returns the original list when Linear returns an error response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("error", { status: 500 }));
    const result = await filterToAllowedLabelIds("team-1", ["a", "b"]);
    expect(result).toEqual({ allowed: ["a", "b"], dropped: [] });
  });

  it("returns the original list when Linear returns a payload without labels", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { team: null } }), { status: 200 })
    );
    const result = await filterToAllowedLabelIds("team-1", ["a", "b"]);
    expect(result).toEqual({ allowed: ["a", "b"], dropped: [] });
  });

  it("returns the original list when fetch throws", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await filterToAllowedLabelIds("team-1", ["a", "b"]);
    expect(result).toEqual({ allowed: ["a", "b"], dropped: [] });
  });
});
