/**
 * Tenant Isolation Tests — Hub-Scoped Read Layer
 *
 * Verifies that hub-read.ts correctly filters data by hub's team mappings
 * and visibility config. No cross-hub data leakage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HUB_1,
  HUB_2,
  MAPPING_HUB1_TEAM_A,
  MAPPING_HUB2_TEAM_B,
  ISSUE_TEAM_A,
  ISSUE_TEAM_B,
  TEAM_A,
  TEAM_B,
} from "./test-helpers";

// Mock supabase
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockIs = vi.fn();
const mockOrder = vi.fn();
const mockSingle = vi.fn();
const mockLimit = vi.fn();

function createChain(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    limit: vi.fn().mockReturnThis(),
  };
  return chain;
}

// Track all queries to verify hub scoping
let queryLog: Array<{ table: string; filters: Record<string, unknown> }> = [];

/** A chain that resolves to zero rows — used for pages past the first. */
function createEmptyChain() {
  const empty: Record<string, unknown> = {
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };
  for (const m of ["select", "eq", "in", "is", "order", "limit", "range"]) {
    empty[m] = vi.fn(() => empty);
  }
  empty.single = vi.fn(() => Promise.resolve({ data: null, error: null }));
  return empty;
}

vi.mock("@/lib/supabase", () => {
  return {
    supabaseAdmin: {
      from: (table: string) => {
        const entry: { table: string; filters: Record<string, unknown> } = {
          table,
          filters: {},
        };
        queryLog.push(entry);

        const chain = {
          select: vi.fn((..._args: unknown[]) => chain),
          eq: vi.fn((col: string, val: unknown) => {
            entry.filters[col] = val;
            return chain;
          }),
          in: vi.fn((col: string, vals: unknown) => {
            entry.filters[`${col}__in`] = vals;
            return chain;
          }),
          is: vi.fn((..._args: unknown[]) => chain),
          order: vi.fn((..._args: unknown[]) => chain),
          limit: vi.fn((..._args: unknown[]) => chain),
          // hub-read pages through PostgREST's 1000-row cap via .range(); the
          // fixtures are far smaller than one page, so only the first page has rows.
          range: vi.fn((from: number, _to: number) => {
            entry.filters["__range_from"] = from;
            return from === 0 ? chain : createEmptyChain();
          }),
          single: vi.fn(() => {
            // Return appropriate data based on table + filters
            if (table === "hub_team_mappings") {
              const hubId = entry.filters["hub_id"];
              if (hubId === HUB_1.id) {
                return Promise.resolve({
                  data: [MAPPING_HUB1_TEAM_A],
                  error: null,
                });
              }
              if (hubId === HUB_2.id) {
                return Promise.resolve({
                  data: [MAPPING_HUB2_TEAM_B],
                  error: null,
                });
              }
              return Promise.resolve({ data: [], error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }),
          then: undefined as unknown,
        };

        // Make the chain thenable for non-single queries
        const makeThenable = () => {
          if (table === "hub_team_mappings") {
            const hubId = entry.filters["hub_id"];
            if (hubId === HUB_1.id) {
              return Promise.resolve({
                data: [MAPPING_HUB1_TEAM_A],
                error: null,
              });
            }
            if (hubId === HUB_2.id) {
              return Promise.resolve({
                data: [MAPPING_HUB2_TEAM_B],
                error: null,
              });
            }
          }

          if (table === "synced_issues") {
            const teamIds = entry.filters["team_id__in"] as string[];
            if (teamIds) {
              const issues = [ISSUE_TEAM_A, ISSUE_TEAM_B].filter((i) =>
                teamIds.includes(i.team_id)
              );
              return Promise.resolve({ data: issues, error: null });
            }
          }

          if (table === "synced_teams") {
            const teamIds = entry.filters["linear_id__in"] as string[];
            if (teamIds) {
              const teams = [
                {
                  linear_id: TEAM_A.linear_team_id,
                  data: { id: TEAM_A.linear_team_id, name: "Team A", key: "A" },
                  created_at: "2026-01-01T00:00:00Z",
                  updated_at: "2026-01-01T00:00:00Z",
                },
                {
                  linear_id: TEAM_B.linear_team_id,
                  data: { id: TEAM_B.linear_team_id, name: "Team B", key: "B" },
                  created_at: "2026-01-01T00:00:00Z",
                  updated_at: "2026-01-01T00:00:00Z",
                },
              ].filter((t) => teamIds.includes(t.linear_id));
              return Promise.resolve({ data: teams, error: null });
            }
          }

          return Promise.resolve({ data: [], error: null });
        };

        // Override the final call to return data
        const origOrder = chain.order;
        chain.order = vi.fn((...args: unknown[]) => {
          origOrder(...args);
          return {
            ...chain,
            then: (
              resolve: (val: unknown) => void,
              reject?: (err: unknown) => void
            ) => makeThenable().then(resolve, reject),
          };
        });

        // For queries that don't call order
        chain.then = ((
          resolve: (val: unknown) => void,
          reject?: (err: unknown) => void
        ) => makeThenable().then(resolve, reject)) as unknown;

        return chain;
      },
    },
  };
});

// Import after mock setup
const { fetchHubIssues, fetchHubTeams } = await import("@/lib/hub-read");

describe("Hub Read Layer — Tenant Isolation", () => {
  beforeEach(() => {
    queryLog = [];
  });

  describe("fetchHubIssues", () => {
    it("Hub 1 only sees Team A issues", async () => {
      const issues = await fetchHubIssues(HUB_1.id);

      expect(issues.length).toBe(1);
      expect(issues[0].identifier).toBe("ALPHA-1");
    });

    it("Hub 2 only sees Team B issues", async () => {
      const issues = await fetchHubIssues(HUB_2.id);

      expect(issues.length).toBe(1);
      expect(issues[0].identifier).toBe("BETA-1");
    });

    it("Hub 1 cannot access Team B issues by passing teamId", async () => {
      const issues = await fetchHubIssues(HUB_1.id, {
        teamId: TEAM_B.linear_team_id,
      });

      // Should return empty — Team B is not mapped to Hub 1
      expect(issues.length).toBe(0);
    });

    it("Issues never include assignee information", async () => {
      const issues = await fetchHubIssues(HUB_1.id);

      for (const issue of issues) {
        expect(issue.assignee).toBeUndefined();
      }
    });

    it("All queries include user_id = workspace", async () => {
      await fetchHubIssues(HUB_1.id);

      const issueQueries = queryLog.filter(
        (q) => q.table === "synced_issues"
      );
      for (const q of issueQueries) {
        expect(q.filters["user_id"]).toBe("workspace");
      }
    });

    it("All queries scope by hub's team IDs", async () => {
      await fetchHubIssues(HUB_1.id);

      const issueQueries = queryLog.filter(
        (q) => q.table === "synced_issues"
      );
      for (const q of issueQueries) {
        const teamFilter = q.filters["team_id__in"] as string[];
        expect(teamFilter).toBeDefined();
        expect(teamFilter).toContain(TEAM_A.linear_team_id);
        expect(teamFilter).not.toContain(TEAM_B.linear_team_id);
      }
    });
  });

  describe("fetchHubTeams", () => {
    it("Hub 1 only sees Team A", async () => {
      const teams = await fetchHubTeams(HUB_1.id);

      expect(teams.length).toBe(1);
      expect(teams[0].id).toBe(TEAM_A.linear_team_id);
    });

    it("Hub 2 only sees Team B", async () => {
      const teams = await fetchHubTeams(HUB_2.id);

      expect(teams.length).toBe(1);
      expect(teams[0].id).toBe(TEAM_B.linear_team_id);
    });
  });

  describe("Label filtering", () => {
    it("Filters labels when visible_label_ids is configured", async () => {
      // Override mapping to restrict visible labels
      const originalMapping = { ...MAPPING_HUB1_TEAM_A };
      MAPPING_HUB1_TEAM_A.visible_label_ids = ["label-1"]; // Only "Bug" visible

      const issues = await fetchHubIssues(HUB_1.id);

      expect(issues.length).toBe(1);
      expect(issues[0].labels.length).toBe(1);
      expect(issues[0].labels[0].name).toBe("Bug");

      // Restore
      MAPPING_HUB1_TEAM_A.visible_label_ids =
        originalMapping.visible_label_ids;
    });

    it("Shows all labels when visible_label_ids is empty", async () => {
      MAPPING_HUB1_TEAM_A.visible_label_ids = [];

      const issues = await fetchHubIssues(HUB_1.id);

      expect(issues.length).toBe(1);
      expect(issues[0].labels.length).toBe(2);
    });
  });
});
