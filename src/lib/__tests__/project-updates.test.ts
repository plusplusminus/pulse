import { describe, it, expect } from "vitest";
import { mapProjectUpdateWebhookToRow } from "../webhook-handlers";
import { mapProjectUpdateToRow } from "../initial-sync";
import { isClientFacing, stripClientPrefix } from "../hub-read";

// PULSE-359: project health updates reuse the comment pulse/heyclient prefix.
// These cover the prefix behaviour on update-style (markdown) bodies plus the
// two pure mappers that land updates in synced_project_updates.

describe("client-facing prefix on project update bodies", () => {
  it("treats pulse/heyclient-prefixed updates as client-facing", () => {
    expect(isClientFacing("pulse We shipped the API this week")).toBe(true);
    expect(isClientFacing("heyclient On track for launch")).toBe(true);
    expect(isClientFacing("@pulse heads up")).toBe(true);
    expect(isClientFacing("PULSE shouting")).toBe(true); // case-insensitive
  });

  it("treats a prefix followed by a newline / markdown heading as client-facing", () => {
    expect(isClientFacing("pulse\n## Weekly update\n- shipped X")).toBe(true);
    expect(isClientFacing("heyclient\n\n## Status")).toBe(true);
  });

  it("treats unprefixed internal updates as NOT client-facing", () => {
    expect(isClientFacing("Internal: we are behind, do not surface")).toBe(false);
    expect(isClientFacing("## Update\nstuff")).toBe(false);
    expect(isClientFacing("the pulse is steady")).toBe(false); // only matches at start
  });

  it("strips the prefix while preserving the rest of the body", () => {
    expect(stripClientPrefix("pulse We shipped the API")).toBe("We shipped the API");
    expect(stripClientPrefix("heyclient On track")).toBe("On track");
    expect(stripClientPrefix("pulse\n## Weekly update")).toBe("## Weekly update");
  });

  it("returns empty string for a bare prefix with no content", () => {
    expect(stripClientPrefix("pulse")).toBe("");
    expect(stripClientPrefix("heyclient ")).toBe("");
  });
});

describe("mapProjectUpdateWebhookToRow", () => {
  const userId = "workspace";

  it("maps a create with nested project + health", () => {
    const data = {
      id: "pu_1",
      body: "pulse on track",
      health: "onTrack",
      project: { id: "proj_1" },
      createdAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };
    const row = mapProjectUpdateWebhookToRow("create", data, userId);
    expect(row.linear_id).toBe("pu_1");
    expect(row.user_id).toBe("workspace");
    expect(row.project_id).toBe("proj_1");
    expect(row.health).toBe("onTrack");
    expect(row.created_at).toBe("2026-06-01T00:00:00.000Z");
    expect(row.data).toEqual(data);
  });

  it("falls back to a flat projectId when project is not nested", () => {
    const data = { id: "pu_2", projectId: "proj_2", health: "atRisk" };
    const row = mapProjectUpdateWebhookToRow("create", data, userId);
    expect(row.project_id).toBe("proj_2");
    expect(row.health).toBe("atRisk");
  });

  it("does not set created_at on update actions", () => {
    const data = {
      id: "pu_3",
      project: { id: "p" },
      updatedAt: "2026-06-02T00:00:00.000Z",
    };
    const row = mapProjectUpdateWebhookToRow("update", data, userId);
    expect(row.created_at).toBeUndefined();
    expect(row.updated_at).toBe("2026-06-02T00:00:00.000Z");
  });
});

describe("mapProjectUpdateToRow (backfill / reconcile)", () => {
  it("maps a GraphQL node with project_id + nested project in data blob", () => {
    const update = {
      id: "pu_10",
      body: "heyclient shipped",
      health: "onTrack",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };
    const row = mapProjectUpdateToRow(update, "proj_9", "workspace");
    expect(row.linear_id).toBe("pu_10");
    expect(row.project_id).toBe("proj_9");
    expect(row.health).toBe("onTrack");
    expect(row.created_at).toBe("2026-05-01T00:00:00.000Z");
    expect(row.updated_at).toBe("2026-05-02T00:00:00.000Z");
    expect((row.data as { project: { id: string } }).project.id).toBe("proj_9");
    expect((row.data as { body: string }).body).toBe("heyclient shipped");
  });

  it("falls back updated_at to createdAt and health to null when missing", () => {
    const update = { id: "pu_11", createdAt: "2026-05-01T00:00:00.000Z" };
    const row = mapProjectUpdateToRow(update, "proj_9", "workspace");
    expect(row.updated_at).toBe("2026-05-01T00:00:00.000Z");
    expect(row.health).toBeNull();
  });
});
