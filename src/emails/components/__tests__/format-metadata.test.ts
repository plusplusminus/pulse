import { describe, it, expect } from "vitest";
import { formatMetadataEntries, humanizeKey } from "../format-metadata";

describe("humanizeKey", () => {
  it("turns snake_case into Title Case", () => {
    expect(humanizeKey("old_status")).toBe("Old Status");
    expect(humanizeKey("new_status")).toBe("New Status");
  });

  it("turns camelCase into Title Case", () => {
    expect(humanizeKey("newHealth")).toBe("New Health");
  });
});

describe("formatMetadataEntries", () => {
  it("returns an empty array for missing metadata", () => {
    expect(formatMetadataEntries(undefined)).toEqual([]);
    expect(formatMetadataEntries(null)).toEqual([]);
  });

  it("shows clean status fields without raw IDs (the PULSE-307 case)", () => {
    // What the status_change generator now produces.
    const entries = formatMetadataEntries({
      old_status: "Todo",
      new_status: "In Progress",
      team_key: "PULSE",
    });
    expect(entries).toEqual([
      { key: "old_status", label: "Old Status", value: "Todo" },
      { key: "new_status", label: "New Status", value: "In Progress" },
    ]);
  });

  it("drops *_id keys and raw UUID values", () => {
    const entries = formatMetadataEntries({
      old_state_id: "8c820fea-c292-4c56-a6da-f2c56276030d",
      new_state: "Done",
      issueId: "abc-123",
    });
    expect(entries.map((e) => e.key)).toEqual(["new_state"]);
  });

  it("drops a bare UUID value even under a friendly key", () => {
    const entries = formatMetadataEntries({
      reference: "8c820fea-c292-4c56-a6da-f2c56276030d",
    });
    expect(entries).toEqual([]);
  });

  it("drops internal and non-string values", () => {
    const entries = formatMetadataEntries({
      _issue_id: "internal",
      excerpt: "hidden comment body",
      old_priority: 2,
      new_priority: 3,
      title: "Fix Daily Digest emails",
    });
    expect(entries).toEqual([
      { key: "title", label: "Title", value: "Fix Daily Digest emails" },
    ]);
  });

  it("does not drop keys that merely end in 'id' as a word", () => {
    const entries = formatMetadataEntries({ grid: "12x12" });
    expect(entries).toEqual([
      { key: "grid", label: "Grid", value: "12x12" },
    ]);
  });
});
