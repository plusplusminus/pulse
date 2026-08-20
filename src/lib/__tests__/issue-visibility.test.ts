import { describe, it, expect } from "vitest";
import { isIssueProjectVisible } from "../hub-visibility-rules";
import type { HubTeamMapping } from "../supabase";

function mapping(overrides: Partial<HubTeamMapping> = {}): HubTeamMapping {
  return {
    id: "m1",
    hub_id: "hub1",
    linear_team_id: "team1",
    linear_team_name: "Team",
    visible_project_ids: [],
    visible_initiative_ids: [],
    visible_label_ids: [],
    hidden_label_ids: [],
    auto_include_projects: false,
    include_unassigned_issues: false,
    overview_only_project_ids: [],
    task_priority_project_ids: [],
    is_active: true,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

const VISIBLE = "proj-visible";
const HIDDEN = "proj-hidden";
const OVERVIEW = "proj-overview";

describe("isIssueProjectVisible", () => {
  it("shows an issue whose project is in the visible list", () => {
    const m = [mapping({ visible_project_ids: [VISIBLE] })];
    expect(isIssueProjectVisible(m, VISIBLE)).toBe(true);
  });

  it("hides an issue whose project is not visible (the PULSE-370 leak)", () => {
    const m = [mapping({ visible_project_ids: [VISIBLE] })];
    expect(isIssueProjectVisible(m, HIDDEN)).toBe(false);
  });

  it("shows any project when auto_include_projects is on", () => {
    const m = [mapping({ auto_include_projects: true })];
    expect(isIssueProjectVisible(m, HIDDEN)).toBe(true);
  });

  it("hides an overview-only project's issues even if otherwise visible", () => {
    const m = [
      mapping({
        visible_project_ids: [VISIBLE, OVERVIEW],
        overview_only_project_ids: [OVERVIEW],
      }),
    ];
    expect(isIssueProjectVisible(m, VISIBLE)).toBe(true);
    expect(isIssueProjectVisible(m, OVERVIEW)).toBe(false);
  });

  it("hides overview-only projects even under auto_include_projects", () => {
    const m = [
      mapping({
        auto_include_projects: true,
        overview_only_project_ids: [OVERVIEW],
      }),
    ];
    expect(isIssueProjectVisible(m, OVERVIEW)).toBe(false);
  });

  describe("project-less issues", () => {
    it("hides them when the hub doesn't include unassigned issues", () => {
      const m = [mapping({ include_unassigned_issues: false })];
      expect(isIssueProjectVisible(m, null)).toBe(false);
      expect(isIssueProjectVisible(m, undefined)).toBe(false);
      expect(isIssueProjectVisible(m, "")).toBe(false);
    });

    it("shows them when the hub opts in", () => {
      const m = [mapping({ include_unassigned_issues: true })];
      expect(isIssueProjectVisible(m, null)).toBe(true);
    });

    it("opts in if any mapping includes unassigned issues", () => {
      const m = [
        mapping({ linear_team_id: "team1", include_unassigned_issues: false }),
        mapping({ id: "m2", linear_team_id: "team2", include_unassigned_issues: true }),
      ];
      expect(isIssueProjectVisible(m, null)).toBe(true);
    });
  });
});
